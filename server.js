const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
// Render assigns the port dynamically, so we use process.env.PORT
const port = process.env.PORT || 3000; 

// --- Configuration ---
const upload = multer({ dest: 'uploads/' }); 
const AUDIO_DIR = path.join(__dirname, 'audio');
const MASTER_FILE = path.join(AUDIO_DIR, 'master_drone.webm');

// Ensure directories exist on server startup
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR);
}
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'));
}

// Middleware to allow your Cargo site (different domain) to talk to the server
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET,POST');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// --- API Endpoint 1: Upload New Recording ---
app.post('/api/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No audio file uploaded.');
    }

    const newFilePath = req.file.path;
    
    try {
        console.log(`Starting compilation for file: ${req.file.originalname}`);
        await compileNewDrone(newFilePath);
        
        fs.unlinkSync(newFilePath);
        console.log('Compilation successful and temporary file removed.');
        res.status(200).send('Successfully added to the communal ahhh!');
    } catch (error) {
        console.error('Compilation Error:', error);
        fs.unlinkSync(newFilePath); 
        res.status(500).send('Failed to compile the new recording.');
    }
});

// --- API Endpoint 2: Serve the Master Drone (For Playback) ---
app.get('/api/master_drone', (req, res) => {
    if (!fs.existsSync(MASTER_FILE)) {
        return res.status(404).send('The communal ahhh has not started yet!');
    }
    
    res.setHeader('Content-Type', 'audio/webm');
    res.sendFile(MASTER_FILE);
});

// --- Audio Compilation with FFmpeg (The Core Logic) ---
function compileNewDrone(newRecordingPath) {
    return new Promise((resolve, reject) => {
        const tempOutputFile = path.join(AUDIO_DIR, `temp_${Date.now()}.webm`);
        const crossfadeDuration = 0.5; // 0.5 seconds

        const isFirstRecording = !fs.existsSync(MASTER_FILE);
        const inputFiles = isFirstRecording ? [newRecordingPath] : [MASTER_FILE, newRecordingPath];

        let command = ffmpeg();
        inputFiles.forEach(file => command.input(file));

        if (isFirstRecording) {
            // First Recording: Trim silence and save as master
            console.log('First recording detected. Trimming silence...');
            command
                .complexFilter([
                    '[0:a]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim1]',
                    '[trim1]areverse[rev1]', 
                    '[rev1]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim2]',
                    '[trim2]areverse[out]', 
                ])
                .outputOptions([
                    '-map [out]', 
                    '-c:a libopus',
                    '-q:a 9',
                    '-b:a 160k',
                    '-f webm'
                ])
                .save(MASTER_FILE)
                .on('end', () => resolve())
                .on('error', (err) => reject(`FFmpeg Error (First): ${err.message}`));

        } else {
            // Subsequent Recordings: Trim silence, crossfade, and save as new master
            console.log('Appending with crossfade...');
            const masterInputIndex = 0; 
            const newAhhhInputIndex = 1; 
            
            command
                .complexFilter([ // <-- CORRECTED: Removed the second 'out' argument here
                    // 1. Isolate and format the master file stream (Input 0)
                    `[${masterInputIndex}:a]aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000[master]`,
                    
                    // 2. Trim and format the new recording (Input 1)
                    `[${newAhhhInputIndex}:a]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02,areverse,silenceremove=start_periods=1:start_duration=1:start_threshold=0.02,areverse,aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000[trimmed_new]`,
                    
                    // 3. Crossfade/Concatenate the two explicitly prepared and formatted streams
                    `[master][trimmed_new]acrossfade=d=${crossfadeDuration}:c1=tri[out]`,
                ]) // <-- REMOVED THE CONFLICTING 'out' ARGUMENT
                .outputOptions([
                    '-map [out]', 
                    '-c:a libopus',
                    '-q:a 9',
                    '-b:a 160k',
                    '-f webm' 
                ])
                .save(tempOutputFile)
                .on('end', () => {
                    fs.renameSync(tempOutputFile, MASTER_FILE);
                    resolve();
                })
                .on('error', (err) => reject(`FFmpeg Error (Crossfade): ${err.message}`));
        }
    });
}

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
