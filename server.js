<div id="sound-art-app" style="text-align: center;">
    <h3>The Communal "Ahhh" Project</h3>
    <button id="recordButton">Start Recording</button>
    <button class="hidden-control" disabled="" id="stopButton">Stop Recording</button>
    <p id="status">Ready to record.</p>
    <div>
        <button class="hidden-control" id="previewButton">Preview Your "Ahhh"</button>
        <button class="hidden-control" disabled="" id="submitButton">SUBMIT to the Collective Ahhh</button>
        <button class="hidden-control" disabled="" id="discardButton">Discard &amp; Re-Record</button>
    </div>
    <!-- Simplified Playback Mode Toggle -->
    <div class="toggle-row" style="justify-content: center; margin-top: 15px; gap: 10px;">
        <span>Simultaneous Playback</span>
        <label class="toggle-switch"><input type="checkbox" id="playback_mode"><span class="toggle-slider"></span></label>
    </div>

    <button id="playChainButton" style="width: 50%; padding: 15px; margin-top: 15px; font-size: 1.2em;">Play the Endless Ahhh</button>
    <button id="unfreezeButton" style="display: block; margin: 10px auto;">Unfreeze Interface</button>
    <div style="position: fixed; bottom: 0; left: 0; width: 100%; background-color: #f0f0f0; padding: 10px; text-align: center; border-top: 1px solid #ccc;">
        <input type="password" id="secretKeyInput" placeholder="secret key">
        <button id="resetButton" title="Reset All Ahhhs">X</button>
    </div>
</div>
<script>
// --- 1. Global Variables (CHANGED TO VAR TO PREVENT DUPLICATE DECLARATION ERROR) ---
var mediaRecorder = null; 
var recordedChunks = [];
var audioStream = null; 
var masterPlaybackAudio = null; // To control the master drone playback

// Your CONFIRMED working Render URL
const SERVER_URL = 'https://ahhhhhhh-68id.onrender.com/api/upload'; 
const MASTER_PLAYBACK_URL = 'https://ahhhhhhh-68id.onrender.com/api/master_drone';
const RESET_URL = 'https://ahhhhhhh-68id.onrender.com/api/reset';

// --- 2. Element References ---
var recordButton; 
var stopButton; 
var unfreezeButton;
var previewButton; 
var submitButton; 
var discardButton; 
var playButton; 
var statusText; 
var secretKeyInput;
var resetButton;

// --- 3. Function to Initialize the Application (Runs AFTER Page Loads) ---
function waitForAppAndInitialize() {
    const appContainer = document.getElementById('sound-art-app');
    if (appContainer) {
        console.log("LOG: App container found. Initializing listeners.");
        // --- Assign elements ---
        recordButton = document.getElementById('recordButton'); 
        stopButton = document.getElementById('stopButton'); 
        unfreezeButton = document.getElementById('unfreezeButton');
        previewButton = document.getElementById('previewButton');
        submitButton = document.getElementById('submitButton');
        discardButton = document.getElementById('discardButton');
        playButton = document.getElementById('playChainButton');
        statusText = document.getElementById('status');
        secretKeyInput = document.getElementById('secretKeyInput');
        resetButton = document.getElementById('resetButton');

        // --- Attach listeners ---
        if (recordButton) recordButton.addEventListener('click', startRecording);
        if (stopButton) stopButton.addEventListener('click', stopRecording);
        if (submitButton) submitButton.addEventListener('click', submitAhhh);
        if (discardButton) discardButton.addEventListener('click', discardAhhh);
        if (playButton) playButton.addEventListener('click', playAhhh);
        if (unfreezeButton) unfreezeButton.addEventListener('click', unfreezeInterface);
        if (previewButton) previewButton.addEventListener('click', previewAhhh);
        if (resetButton) resetButton.addEventListener('click', resetAhhs);

        if (statusText) statusText.textContent = "Press 'Start Recording' to request microphone access. Recording will begin after 3 second countdown.";
    } else {
        console.log("LOG: App container not found yet. Retrying in 100ms.");
        setTimeout(waitForAppAndInitialize, 100); // Retry after a short delay
    }
}

// Start the initialization check.
waitForAppAndInitialize();

// --- 4. Main Application Functions ---

// This function handles getting the mic access when the button is clicked
async function getMicrophoneAccess() {
    // If the stream from a previous session is still active, we can reuse it.
    // However, the MediaRecorder MUST be created fresh for each new recording.
    if (audioStream && audioStream.active) {
        console.log("LOG: Reusing existing microphone stream.");
    } else {
        if (statusText) statusText.textContent = "Requesting microphone access...";
        console.log("LOG: Requesting new microphone access...");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioStream = stream;
        } catch (err) {
            if (statusText) statusText.textContent = "ERROR: Microphone permission denied. Use Unfreeze Failsafe.";
            console.error('ERROR: Microphone access failed:', err);
            return null; // Return null on failure
        }
    }
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
        mediaRecorder.ondataavailable = function(e) {
            recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = function() {
            if (statusText) statusText.textContent = "Recording complete. Ready to preview or submit.";
            if (previewButton) previewButton.classList.remove('hidden-control');
            if (submitButton) submitButton.classList.remove('hidden-control');
            if (discardButton) discardButton.classList.remove('hidden-control');
            if (recordButton) recordButton.disabled = false;
            if (submitButton) submitButton.disabled = false;
            if (discardButton) discardButton.disabled = false;
        };
        console.log("LOG: Microphone stream acquired successfully.");
    return audioStream; // Return the stream to indicate success
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startRecording() {
    // Disable button immediately to prevent multiple clicks
    if (recordButton) recordButton.disabled = true;

    const stream = await getMicrophoneAccess();
    
    if (!stream || !mediaRecorder) {
        if (statusText) statusText.textContent = "ERROR: Cannot start recording without microphone access.";
        if (recordButton) recordButton.disabled = false; // Re-enable on failure
        return;
    }

    // --- Countdown Logic ---
    if (statusText) statusText.textContent = "Get ready...";
    await sleep(1000);
    if (statusText) statusText.textContent = "3...";
    await sleep(1000);
    if (statusText) statusText.textContent = "2...";
    await sleep(1000);
    if (statusText) statusText.textContent = "1...";
    await sleep(1000);

    recordedChunks = [];
    mediaRecorder.start();
    if (statusText) statusText.textContent = "Recording... (Max 5 seconds)";
    if (stopButton) stopButton.disabled = false;
    
    // Hide post-recording controls while recording
    if (submitButton) submitButton.classList.add('hidden-control');
    if (discardButton) discardButton.classList.add('hidden-control');
    if (previewButton) previewButton.classList.add('hidden-control');

    // --- Automatically stop recording after 5 seconds ---
    setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
        }
    }, 5000); // 5000 milliseconds = 5 seconds
}

function stopRecording() {
    if (!mediaRecorder) return;
    mediaRecorder.stop();
    if (recordButton) recordButton.disabled = true;
    if (stopButton) stopButton.disabled = true;
    if (statusText) statusText.textContent = "Processing recording...";
}

function submitAhhh() {
    if (recordedChunks.length === 0) {
        if (statusText) statusText.textContent = "Error: Nothing recorded to submit.";
        return;
    }
    
    if (statusText) statusText.textContent = "Submitting to the collective ahhh... please wait.";
    if (submitButton) submitButton.disabled = true;
    if (discardButton) discardButton.disabled = true;
    if (recordButton) recordButton.disabled = true; 
    
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', blob, 'my-ahhh.webm');
    
    fetch(SERVER_URL, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json()) // Expect a JSON response from the server
    .then(data => {
        // Check for the specific success status from our server
        if (data && data.status === 'processed') {
            if (statusText) statusText.textContent = "Submission successful! Your ahhh is now part of the drone.";
            recordedChunks = []; // Clear the recording
        } else {
            // If the server gives a success status code but not our expected message, something is wrong.
            throw new Error(data.message || 'Server response was not as expected.');
        }
    })
    .catch(error => {
        // This will now catch network errors, JSON parsing errors, or our thrown error.
        if (statusText) statusText.textContent = "Submission failed: " + (error.message || error);
        console.error('Submission Error:', error);
    })
    .finally(() => {
        if (recordButton) recordButton.disabled = false;
        if (stopButton) stopButton.disabled = true; 
        if (submitButton) submitButton.classList.add('hidden-control');
        if (discardButton) discardButton.classList.add('hidden-control');
        if (previewButton) previewButton.classList.add('hidden-control');
    });
}

function playAhhh() {
    if (masterPlaybackAudio && !masterPlaybackAudio.paused) {
        masterPlaybackAudio.pause();
        masterPlaybackAudio.currentTime = 0;
        masterPlaybackAudio = null;
        if (statusText) statusText.textContent = "Playback stopped. Ready to record. Recording will begin after 3 second countdown.";
        if (playButton) playButton.textContent = "Play the Endless Ahhh";
        return;
    }

    if (statusText) statusText.textContent = "Attempting to play the endless ahhh...";
    if (playButton) playButton.textContent = "Stop the Endless Ahhh";

    // Check the state of the new toggle switch
    const playbackModeSwitch = document.getElementById('playback_mode');
    const mode = playbackModeSwitch.checked ? 'simultaneous' : 'sequential';

    // Construct the URL with the special ordering, the chosen mode, and a cache-buster
    const playbackUrl = `${MASTER_PLAYBACK_URL}?order=special&mode=${mode}&t=${new Date().getTime()}`;

    masterPlaybackAudio = new Audio(playbackUrl);
    masterPlaybackAudio.loop = true;
    masterPlaybackAudio.play()
        .then(() => {
            if (statusText) statusText.textContent = "Playing the endless ahhh... Click the button again to stop.";
        })
        .catch(error => {
            let errorMessage;
            // This specific error message often means the server sent an invalid audio source,
            // which can happen if no recordings exist yet.
            if (error.message.includes("no supported source was found")) {
                errorMessage = "Playback failed. Have any 'ahhhs' been submitted yet? The drone needs at least one recording to play.";
            }
            if (statusText) statusText.textContent = errorMessage;
            console.error('Playback Error:', error);
            if (playButton) playButton.textContent = "Play the Endless Ahhh";
            masterPlaybackAudio = null;
        });
}

function discardAhhh() {
    recordedChunks = [];
    if (statusText) statusText.textContent = "Discarded. Ready to record. Recording will begin after 3 second countdown.";
    
    if (submitButton) submitButton.classList.add('hidden-control');
    if (discardButton) discardButton.classList.add('hidden-control');
    if (previewButton) previewButton.classList.add('hidden-control');
    if (recordButton) recordButton.disabled = false; 
}

function unfreezeInterface() {
    if (recordButton) recordButton.disabled = false;
    if (stopButton) stopButton.disabled = true;
    if (submitButton) submitButton.disabled = true;
    if (discardButton) discardButton.disabled = true;
    if (statusText) statusText.textContent = "Interface unfrozen. Ready to record. Recording will begin after 3 second countdown.";
    console.log("Interface unfrozen.");
}

function previewAhhh() {
    if (recordedChunks.length === 0) {
        if (statusText) statusText.textContent = "Nothing to preview.";
        return;
    }
    if (statusText) statusText.textContent = "Previewing your 'Ahhh'...";
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    audio.play()
        .catch(err => console.error("Preview playback failed:", err));
    audio.onended = () => {
        if (statusText) statusText.textContent = "Preview finished. Ready to submit or discard.";
    };
}

function resetAhhs() {
    const secret = secretKeyInput.value;
    if (!secret) {
        if (statusText) statusText.textContent = "Please enter the secret key to reset.";
        return;
    }

    if (statusText) statusText.textContent = "Attempting to reset all recordings...";

    fetch(RESET_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secret: secret }),
    })
    .then(response => response.text().then(text => {
        if (!response.ok) {
            throw new Error(text || 'Failed with status: ' + response.status);
        }
        if (statusText) statusText.textContent = "Reset successful: " + text;
        if (secretKeyInput) secretKeyInput.value = ''; // Clear the input
    }))
    .catch(error => {
        if (statusText) statusText.textContent = "Reset failed: " + error.message;
        console.error('Reset Error:', error);
    });
}
</script>
