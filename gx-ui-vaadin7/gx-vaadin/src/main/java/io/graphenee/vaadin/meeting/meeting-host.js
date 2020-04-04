var configuration = {
	"iceServers": [
      {
        "url": "stun:global.stun.twilio.com:3478?transport=udp",
        "urls": "stun:global.stun.twilio.com:3478?transport=udp"
      },
      {
        "url": "turn:global.turn.twilio.com:3478?transport=udp",
        "username": "a494d642d5f2eae2e9c6e7cc8b32801d96e129b6b24e51fec31de96e6785f053",
        "urls": "turn:global.turn.twilio.com:3478?transport=udp",
        "credential": "6mfV4MNuOhbdXfrvVsYY7v2oIC8cNsGrEREI1NyKH0c="
      },
      {
        "url": "turn:global.turn.twilio.com:3478?transport=tcp",
        "username": "a494d642d5f2eae2e9c6e7cc8b32801d96e129b6b24e51fec31de96e6785f053",
        "urls": "turn:global.turn.twilio.com:3478?transport=tcp",
        "credential": "6mfV4MNuOhbdXfrvVsYY7v2oIC8cNsGrEREI1NyKH0c="
      },
      {
        "url": "turn:global.turn.twilio.com:443?transport=tcp",
        "username": "a494d642d5f2eae2e9c6e7cc8b32801d96e129b6b24e51fec31de96e6785f053",
        "urls": "turn:global.turn.twilio.com:443?transport=tcp",
        "credential": "6mfV4MNuOhbdXfrvVsYY7v2oIC8cNsGrEREI1NyKH0c="
      }
    ]
}

var localStream = null;
var ws = null;
var peers = new Map();
var videos = new Map();
var localUserId = null;

// initialize websockets...
function initializeWebSocket(wsurl, userId) {
	localUserId = userId;
	if(ws)
		return;
	ws = new WebSocket(wsurl);
	// when a new message will arrive...
	ws.onmessage = function (m) {
	    var message = JSON.parse(m.data);
	    if (message.event == "candidate") {
	        handleCandidate(message.data, message.userId);
	    } else if (message.event == "offer") {
	        handleOffer(message.data, message.userId);
	    } else {
	        console.log("Invalid Message", message);
	    }
	};
	// when socket will be closed...
	ws.onclose = function(e) {
	    console.log('Socket is closed. Reconnect will be attempted in 5 second.', e.reason);
	    setTimeout(function() {
	      ws = null;
	      initializeWebSocket(wsurl, userId);
	    }, 5000);
	};
	// when an error will occur...
	ws.onerror = function(err) {
	    console.error('Socket encountered error: ', err.message);
	    // ws.close();
	};
}

// called when websocket will receive candidate
async function handleCandidate(candidate, userId) {
	var pc = createPeer(userId);
	try {
		await pc.addIceCandidate(new RTCIceCandidate(candidate));
	} catch(error) {
		console.log(error);
	}
}

// called when websocket will receive offer from any of the connected peer,
// typically from the host peer.
async function handleOffer(offer, userId) {
	var pc = createPeer(userId);
	var session = new RTCSessionDescription(offer);
    await pc.setRemoteDescription(session);
    try {
    	var answer = await pc.createAnswer();
    	await pc.setLocalDescription(answer);
		ws.send(JSON.stringify({
	         event: "answer",
	         data: answer
	    }));
    } catch(error) {
        console.log("Error", error);
    }
}

// creates a peer connection if does not already exist. Each peer on the meeting
// must have a connection for other peers.
function createPeer(userId) {
	var pc = peers.get(userId);
	if(pc == null) {
		console.log("Peer for: " + userId)
		pc = initializePeerConnection(userId);
		peers.set(userId, pc);
		videos.set(pc, createVideoId(userId));
	}
	return pc;
}

// creates a new peer connection for userId and videoId
function initializePeerConnection(userId) {
    var pc = new RTCPeerConnection(configuration);
    var isNegotiating = false;
    // is called when new candidate is discovered
    pc.onicecandidate = function (event) {
    	if(event.candidate) {
	        ws.send(JSON.stringify({
	            event: "candidate",
	            data: event.candidate
	        }));
    	}
    };
    // called when allow button is clicked on any of the media stream.
    pc.onnegotiationneeded = function (event) {
    	if(isNegotiating)
    		return;
    	isNegotiating = true;
    	ws.send(JSON.stringify({
            event: "request-offer",
            userId: userId,
            data: event.candidate
        }));
    };
    // Workaround for Chrome: skip nested negotiations
    pc.onsignalingstatechange = (e) => { 
    	isNegotiating = (pc.signalingState != "stable");
    }
    // called when a stream is added on the remote peer whose ice candidate is
	// known.
    pc.onaddstream = function (event) {
    	if(event.stream) {
    		var remoteVideo = document.getElementById(videos.get(pc));
    		remoteVideo.srcObject = event.stream;
    	}
    }

    pc.ontrack = function(event) {
    	if(event.track) {
    		var remoteVideo = document.getElementById(videos.get(pc));
    		var remoteStream = remoteVideo.srcObject;
    		if(remoteStream == null) {
    	    	remoteStream = new MediaStream();
        	    remoteVideo.srcObject = remoteStream;
    	    }
    		remoteStream.addTrack(event.track, remoteStream);
    	}
    }
    
    return pc;
}

// called when camera button is clicked on the meeting component.
async function startCamera() {
	var constraints = {
		video : true,
		audio : true
	}
	try {
		var stream = await navigator.mediaDevices.getUserMedia(constraints);
		localStream = stream;
		var myVideo = document.getElementById('localVideo');
		myVideo.muted = true;
		myVideo.srcObject = localStream;
		localStream.getTracks().forEach(track => {
		    peers.forEach(pc => pc.addTrack(track, localStream));
		});
	} catch(error) {
		console.log("Error", error);
	}
}

// called when screen button is clicked on the meeting component.
async function startScreen() {
	try {
		var stream = await navigator.mediaDevices.getDisplayMedia();
		localStream = stream;
		var myVideo = document.getElementById('localVideo');
		myVideo.muted = true;
		myVideo.srcObject = localStream;
		localStream.getTracks().forEach(track => {
		    peers.forEach(pc => pc.addTrack(track, localStream));
		});
	} catch(error) {
		console.log(error);
	}
}

// mute all attendees...
function muteAllAttendees() {
	videos.forEach(v => {
		document.getElementById(v).muted=true;
 	});
}

// unmute all attendees...
function unmuteAllAttendees() {
	videos.forEach(v => {
		document.getElementById(v).muted=false;
 	});
}

// mute single attendee...
function muteAttendee(userId) {
	document.getElementById(createVideoId(userId)).muted = true;
}

//unmute single attendee...
function unmuteAttendee(userId) {
	document.getElementById(createVideoId(userId)).muted = false;
}

function createVideoId(userId) {
	console.log("UserID: " + userId);
	return 'vid_' + userId.replace('-', '_').replace('.', '_');
}