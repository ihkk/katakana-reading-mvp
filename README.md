# Katakana Reading MVP

A browser-based MVP for running a Japanese word reading experiment. Participants read displayed words aloud, answer what they know about each word's meaning or provide an example sentence by voice, and respond to 1-5 post-trial questions. The app records audio locally in the browser and exports the collected results as downloadable files.

## What This App Does

This project supports a simple experiment flow:

1. Enter a participant `Subject ID`.
2. Allow microphone access and optionally choose an input device.
3. Read the experiment instructions.
4. Complete 5 practice trials using the same flow as the main trials.
5. Complete the main trials in randomized order.
6. Download the results JSON and all recorded audio files.

Each trial contains:

- A ready screen with a `開始する` button.
- A 3-second countdown.
- A displayed stimulus word.
- A reading-aloud recording, stopped by pressing `Space`.
- A meaning/example-sentence recording for the same word, started automatically and stopped by pressing `Space`.
- One-at-a-time 1-5 Likert questions:
  - Familiarity
  - Confidence in meaning understanding
  - Exposure frequency
  - Usage frequency

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Browser `MediaRecorder` API

There is no backend service. All recordings and result data are kept in browser memory during the session and exported through downloads at the end.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview a production build:

```bash
npm run preview
```

## Browser Requirements

Use a modern browser that supports:

- `navigator.mediaDevices.getUserMedia`
- `MediaRecorder`
- WebM audio recording

Chrome or Edge are recommended for the most predictable recording behavior. The app must be served from `localhost` or a secure HTTPS origin for microphone access to work.

## Output Files

At the end of the experiment, the app can download all data as a single ZIP file:

```text
<subjectId>_<YYYYMMDD_HHMMSS>_experiment_data.zip
```

The ZIP contains:

- `<subjectId>_results.json`
- `<subjectId>_trials.csv`
- `audio/` folder with all reading recordings and meaning/example-sentence recordings

Separate JSON-only, CSV-only, and audio-only downloads are also available as backup actions.

### Results JSON

The downloaded JSON file is named:

```text
<subjectId>_results.json
```

It contains:

- Participant metadata
- Browser user agent
- Practice and main stimulus order
- Trial-level stimulus information
- Reading response time
- Meaning-response recording time
- Audio file names
- Likert survey responses

The audio blobs themselves are not embedded in the JSON.

### Trial CSV

The CSV file is named:

```text
<subjectId>_trials.csv
```

It contains one row per completed trial, including the stimulus, script label (`hiragana`, `katakana`, or `mixed`), practice type (`normal` or `none`), response times, survey scores, and audio file names.

### Audio Files

Inside the ZIP, each completed trial has one reading recording and one meaning/example-sentence recording:

```text
practice_001_reading.webm
practice_001_meaning.webm
trial_001_reading.webm
trial_001_meaning.webm
```

The exact MIME type is selected from browser-supported WebM options.

## Stimuli

Stimuli are currently defined directly in `src/App.tsx`.

- Practice stimuli: 5 items
- Main stimuli: defined in `MAIN_STIMULI`
- Main stimuli are shuffled once when the app loads
- Practice stimuli keep their defined order

## Project Structure

```text
.
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── App.tsx       # Experiment flow, state, stimuli, recording, export UI
│   ├── index.css     # Tailwind entry
│   └── main.tsx      # React entry point
├── vite.config.ts
├── package.json
└── README.md
```

## Current Limitations

- Data is only stored in memory until exported. Refreshing the page loses the current session.
- There is no backend upload, participant management, or automatic backup.
- Stimuli are hard-coded in the React component.
- The README describes the current MVP behavior, not a finalized research protocol.
- Some legacy recording helper code remains in `src/App.tsx`; the active flow uses the `_V2` recording functions.

## Development Notes

Run linting:

```bash
npm run lint
```

Before using the app in a real session, do a short test run in the target browser and confirm that:

- Microphone permission is granted.
- Audio files download correctly.
- The results JSON includes the expected number of practice and main trials.
- Pressing `Space` reliably advances the recording steps.
