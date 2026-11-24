# Melzo — YT Music Stream

**Maintained by Prashant** — [github.com/prakha194](https://github.com/prakha194) · [Yt-music-for-Melzo](https://github.com/prakha194/Yt-music-for-Melzo)

A Melzo extension that finds the official YouTube Music recording of the song you are
playing and offers its AAC/M4A audio for **playback** and for **downloads**. When it cannot match a
song, the app plays from Spotify as before.

> **Provenance.** This is a Melzo build of
> [youtubemusic-myspoti](https://gitlab.com/solidsnakeater/youtubemusic-myspoti) by **solidsnakeater**,
> itself an adaptation of [YouTube Music Download Helper](https://github.com/y-exe/orpheon-youtube-music)
> by **y-exe**. Both are GPL-3.0. All of the matching and playback code is theirs — this fork changes
> the extension id, name, author and metadata only, and adds the notice the GPL asks for.
> If you want the original, install it from its own repository.

## What it asks for

| Action | Level | Why |
|---|---|---|
| Play audio from elsewhere | critical | Plays the matching track from YouTube Music |
| Provide downloads | critical | Finds the official song on YouTube Music to download |
| Use the internet | normal | Searches songs, gets audio URLs, checks them |

Hosts it may contact: `music.youtube.com`, `youtubei.googleapis.com`, `*.googlevideo.com`. Nothing
else, and nothing is sent to the author.

## Install

1. In Melzo: **Settings → Extensions → Store**, then install from the address
   `https://github.com/prakha194/Yt-music-for-Melzo`
   (or **Install from a file** and pick `extension.zip` from the release).
2. Read the permissions, accept, done.
3. **Make it the audio source:** Settings → Playback → audio sources, and move this extension
   **above Spotify**. Otherwise Spotify is asked first and the extension is never used for
   playback.
4. For offline listening, enable this source in **Settings → Downloads** and pick the quality there.

Menu names move between versions; if a step is missing, look for the closest name in Settings.

## How it matches

The song's title, artist and length are matched against YouTube Music's official catalogue,
searching in the song's own writing system with English as a fallback. Covers, live versions,
remixes and karaoke wording are refused; remaster notes cost score instead of refusing. Rate limits
are reported to the app, which retries later rather than marking the song as not found.

## Limits worth knowing

- It depends on YouTube Music's **private endpoints**. When YouTube changes them, matching stops
  until the code is updated upstream.
- It is the YouTube Music case: the app's extension policy allows it only if you have the right to
  the content you play, and the Store may hide or block it on a report.
- Max quality is what YouTube serves (AAC 256 / Opus 160 / AAC 128) — there is no lossless here.

## Licence

GPL-3.0. See `LICENSE` (the original notices are kept). If you reuse this, credit
solidsnakeater, y-exe and the Melzo build, and publish your complete source under GPL-3.0.
