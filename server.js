// Complete updated server code using FFmpeg concat demuxer

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const os = require('os');

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
  console.log('Using ffmpeg-static at', ffmpegPath);
}

const app = express();
const port = process.env.PORT || 3000;

const PERSISTENT_STORAGE_PATH = '/var/data/ahhhhhhh_files';
const UPLOAD_DIR = '/tmp/uploads';

const upload = multer({ dest: UPLOAD_DIR });

// Ensure directories
if (!fs.existsSync(PERSISTENT_STORAGE_PATH)) fs.mkdirSync(PERSISTENT_STORAGE_PATH, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

// ---- Upload Endpoint ----
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).send('No audio file uploaded.');

  const tempUploadPath = req.file.path;
  const finalPath = path.join(PERSISTENT_STORAGE_PATH, `ahhh-${Date.now()}.webm`);

  try {
    await trimAndSave(tempUploadPath, finalPath);
    res.status(200).json({ message: 'Successfully added to the communal ahhh!', status: 'processed' });
  } catch (error) {
    console.error('Error processing upload:', error);
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
    res.status(500).send('Failed to process the new recording.');
  }
});

// ---- Master Drone (Concat Demuxer Version) ----
app.get('/api/master_drone', async (req, res) => {
  try {
    const files = fs.readdirSync(PERSISTENT_STORAGE_PATH)
      .filter(file => file.endsWith('.webm'))
      .map(file => {
        const filePath = path.join(PERSISTENT_STORAGE_PATH, file);
        const stats = fs.statSync(filePath);
        return { name: file, path: filePath, time: stats.mtime.getTime(), size: stats.size };
      })
      .filter(f => f.size > 0)
      .sort((a, b) => b.time - a.time);

    if (files.length === 0) return res.status(404).send('The communal ahhh has not started yet!');

    // Single-file fast path
    if (files.length === 1) {
      res.setHeader('Content-Type', 'audio/webm');
      return res.sendFile(files[0].path);
    }

    // Playlist ordering
    let playlist = [];
    if (req.query.order === 'special' && files.length > 1) {
      const mostRecent = files.shift();
      const others = files;
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [others[i], others[j]] = [others[j], others[i]];
      }
      playlist = [mostRecent, ...others].map(f => f.path);
    } else {
      playlist = files.reverse().map(f => f.path);
    }

    // Create temporary concat list
    const listName = `ffconcat-${Date.now()}-${Math.random() * 9999 | 0}.txt`;
    const listPath = path.join(os.tmpdir(), listName);
    const listContent = playlist.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    res.setHeader('Content-Type', 'audio/webm');

    const cmd = ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
     // Force re-encode all concatenated inputs to standardized Opus/webm
.outputOptions([
  '-c:a', 'libopus',
  '-b:a', '160k',
  '-ar', '48000',
  '-ac', '2',
  '-f', 'webm'
])

      .on('start', line => console.log('FFmpeg start:', line))
      .on('stderr', line => console.log('FFmpeg stderr:', line))
      .on('error', (err) => {
        console.error('FFmpeg error:', err.message);
        if (!res.headersSent) res.status(500).send('Error during audio concatenation.');
        try { fs.unlinkSync(listPath); } catch {}
      })
      .on('end', () => {
        console.log('FFmpeg finished.');
        try { fs.unlinkSync(listPath); } catch {}
      });

    const stream = cmd.pipe(res);

    req.on('close', () => {
      if (!res.writableEnded) {
        console.log('Client disconnected. Killing ffmpeg.');
        try { cmd.kill('SIGKILL'); } catch {}
      }
      try { fs.unlinkSync(listPath); } catch {}
    });

  } catch (err) {
    console.error('Master drone error:', err);
    res.status(500).send('Could not generate the communal ahhh.');
  }
});

// ---- Reset Endpoint ----
app.post('/api/reset', (req, res) => {
  const { secret } = req.body;
  const RESET_SECRET = process.env.RESET_SECRET || 'lulu';

  if (secret !== RESET_SECRET) return res.status(403).send('Forbidden: Invalid secret key.');

  try {
    const files = fs.readdirSync(PERSISTENT_STORAGE_PATH);
    files.forEach(file => fs.unlinkSync(path.join(PERSISTENT_STORAGE_PATH, file)));
    res.status(200).send('The communal ahhh has been reset.');
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).send('An error occurred while trying to reset the recordings.');
  }
});

// ---- Silence Trimming ----
function trimAndSave(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .complexFilter([
        '[0:a]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim1]',
        '[trim1]areverse[rev1]',
        '[rev1]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim2]',
        '[trim2]areverse[out]' ] )
      .outputOptions(['-map [out]', '-c:a libopus', '-b:a 160k', '-f webm'])
      .save(outputPath)
      .on('end', async () => {
        try {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          const stats = await fs.promises.stat(outputPath);
          if (stats.size === 0) {
            await fs.promises.unlink(outputPath);
            return reject(new Error('Recording empty after trimming.'));
          }
          resolve();
        } catch (err) {
          reject(new Error('Stat/verify failed: ' + err.message));
        }
      })
      .on('error', (err) => reject(new Error('FFmpeg trimming error: ' + err.message)));
  });
}

// ---- Start Server ----
app.listen(port, () => console.log(`Server running on port ${port}`));
