/* =============================================
   AUDIZE - Music Player Engine
   ============================================= */

// ========== DOM REFS ==========
const uploadScreen = document.getElementById('upload-screen')
const playerScreen = document.getElementById('player-screen')
const dropZone = document.getElementById('drop-zone')
const fileInput = document.getElementById('file-input')
const uploadBtn = document.getElementById('upload-btn')
const audioContainer = document.getElementById('audio-container')
const coverArt = document.getElementById('cover-art')
const coverContainer = document.getElementById('cover-container')
const bgCover = document.getElementById('bg-cover')
const songTitle = document.getElementById('song-title')
const songArtist = document.getElementById('song-artist')
const metaAlbum = document.getElementById('meta-album')
const metaYear = document.getElementById('meta-year')
const metaGenre = document.getElementById('meta-genre')
const metaSamplerate = document.getElementById('meta-samplerate')
const metaBitrate = document.getElementById('meta-bitrate')
const metaChannels = document.getElementById('meta-channels')
const metaFormat = document.getElementById('meta-format')
const metaTrack = document.getElementById('meta-track')
const metaDuration = document.getElementById('meta-duration')
const extraMeta = document.getElementById('extra-meta')
const playBtn = document.getElementById('play-btn')
const seekBar = document.getElementById('seek-bar')
const volumeBar = document.getElementById('volume-bar')
const muteBtn = document.getElementById('mute-btn')
const currentTime = document.getElementById('current-time')
const duration = document.getElementById('duration')
const canvas = document.getElementById('visualizer')
const ctx = canvas.getContext('2d')
const backBtn = document.getElementById('back-btn')

// ========== STATE ==========
let isPlaying = false
let isMuted = false
let seekDragging = false // prevents timeupdate from fighting user drag
let audioContext = null
let analyser = null
let source = null
let rafId = null
let idleRaf = null
let currentFile = null
let currentFileUrl = null
let smoothData = null
let waveformBuffer = null // Reusable buffer for waveform drawing
let freqDataArray = null // Reusable buffer for frequency data
let audioEl = null // Will be created dynamically

// Playlist
let playlist = [] // Array of { file, url, title, artist, album, duration, picture? }
let currentIndex = -1
let repeatMode = 'none' // 'none' | 'all' | 'one'
let shuffleMode = false
let shuffleOrder = [] // shuffled indices mapping
let originalPlaylistOrder = null //保存shuffle前的原始顺序

// Equalizer
let eqFilters = { bass: null, mid: null, treble: null }
let eqOpen = false

// Visualizer mode
let visualizerMode = 'bars' // 'bars' | 'radial'

// Crossfade
const CROSSFADE_DURATION = 3 // seconds
let crossfading = false
let crossfadeGain = null // gain node for the current source
let nextAudioEl = null
let nextSource = null
let nextGain = null
let crossfadeTimeoutId = null // setTimeout for crossfade completion
let crossfadeSafetyId = null // setTimeout for safety fallback

// ========== IndexedDB PLAYLIST PERSISTENCE ==========
const DB_NAME = 'audize-playlist'
const DB_VERSION = 1
const STORE_NAME = 'tracks'
let db = null

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const idb = e.target.result
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        idb.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = (e) => {
      db = e.target.result
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
}

function dbPut(track) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(track)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function dbClear() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function dbEstimateSize() {
  return new Promise((resolve) => {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage
        .estimate()
        .then((est) => {
          resolve({ used: est.usage || 0, quota: est.quota || 0 })
        })
        .catch(() => resolve({ used: 0, quota: 0 }))
    } else {
      resolve({ used: 0, quota: 0 })
    }
  })
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
}

/** Save the current playlist to IndexedDB */
async function savePlaylistToDB() {
  if (!db) return
  try {
    await dbClear()
    const tracks = []
    for (let i = 0; i < playlist.length; i++) {
      const item = playlist[i]
      // Read file as ArrayBuffer for storage
      const arrayBuffer = await item.file.arrayBuffer()
      tracks.push({
        id: i,
        name: item.file.name,
        type: item.file.type,
        size: item.file.size,
        data: arrayBuffer,
        title: item.title,
        artist: item.artist,
        album: item.album,
        duration: item.duration,
        picture: item.picture || null,
        addedAt: item.addedAt || Date.now(),
      })
    }
    for (const track of tracks) {
      await dbPut(track)
    }
    updateStorageInfo()
  } catch (e) {
    console.warn('Failed to save playlist:', e)
  }
}

/** Load playlist from IndexedDB */
async function loadPlaylistFromDB() {
  if (!db) return false
  try {
    const rows = await dbGetAll()
    if (!rows || rows.length === 0) return false

    // Sort by id to maintain order
    rows.sort((a, b) => a.id - b.id)

    // Revoke old URLs
    playlist.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url)
    })
    playlist = []
    originalPlaylistOrder = null
    sortOriginalOrder = null

    for (const row of rows) {
      const blob = new Blob([row.data], { type: row.type })
      const file = new File([blob], row.name, { type: row.type })
      const url = URL.createObjectURL(file)
      playlist.push({
        file,
        url,
        title: row.title || row.name.replace(/\.[^/.]+$/, ''),
        artist: row.artist || 'Artista Desconhecido',
        album: row.album || '',
        duration: row.duration || 0,
        picture: row.picture || null,
        addedAt: row.addedAt || Date.now(),
      })
    }

    updateStorageInfo()
    return true
  } catch (e) {
    console.warn('Failed to load playlist:', e)
    return false
  }
}

/** Update storage usage display */
async function updateStorageInfo() {
  const el = document.getElementById('storage-info')
  if (!el) return
  const est = await dbEstimateSize()
  if (est.quota > 0) {
    const pct = ((est.used / est.quota) * 100).toFixed(1)
    el.textContent = formatBytes(est.used) + ' / ' + formatBytes(est.quota) + ' (' + pct + '%)'
  } else {
    el.textContent = formatBytes(est.used) + ' used'
  }
}

// ========== AUDIO ELEMENT FACTORY ==========
function createAudioElement() {
  // Remove old audio element if exists
  const old = document.getElementById('audio-element')
  if (old) old.remove()

  const el = new Audio()
  el.id = 'audio-element'
  el.preload = 'metadata'
  audioContainer.appendChild(el)
  return el
}

// ========== CANVAS RESIZE ==========
function resizeCanvas() {
  const parent = canvas.parentElement
  // Use offset dimensions (more reliable than getBoundingClientRect for layout)
  let w = parent.offsetWidth
  let h = parent.offsetHeight
  // Fallback: read CSS dimensions if layout hasn't happened yet
  if (!w || !h) {
    const cs = getComputedStyle(parent)
    w = parseInt(cs.width) || 300
    h = parseInt(cs.height) || 140
  }
  canvas.width = w
  canvas.height = h
}

// ========== UPLOAD SCREEN ==========

// Particles
function createParticles() {
  const container = document.getElementById('upload-particles')
  const style = getComputedStyle(document.documentElement)
  const c1 = style.getPropertyValue('--accent-1').trim() || '#00d4ff'
  const c2 = style.getPropertyValue('--accent-2').trim() || '#7b2ff7'
  const c3 = style.getPropertyValue('--accent-3').trim() || '#ff2d95'

  container.innerHTML = ''
  for (let i = 0; i < 30; i++) {
    const span = document.createElement('span')
    span.style.left = Math.random() * 100 + '%'
    span.style.width = span.style.height = 2 + Math.random() * 4 + 'px'
    span.style.animationDuration = 12 + Math.random() * 20 + 's'
    span.style.animationDelay = Math.random() * 20 + 's'
    span.style.background = [c1, c2, c3][Math.floor(Math.random() * 3)]
    container.appendChild(span)
  }
}

// Drop zone events
dropZone.addEventListener('click', () => fileInput.click())

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropZone.classList.add('drag-over')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over')
})

dropZone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')
  const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('audio/'))
  if (files.length > 0) {
    loadFiles(files)
  }
})

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files).filter((f) => f.type.startsWith('audio/'))
  if (files.length > 0) {
    if (playerScreen.classList.contains('hidden')) {
      // Upload screen → fresh load
      loadFiles(files)
    } else {
      // Player visible → append to existing playlist
      addFiles(files)
    }
  }
  fileInput.value = ''
})

uploadBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  fileInput.click()
})

// ========== LOAD FILES (Playlist) ==========
function loadFiles(files) {
  // Stop current playback and crossfade
  crossfading = false
  if (crossfadeTimeoutId) {
    clearTimeout(crossfadeTimeoutId)
    crossfadeTimeoutId = null
  }
  if (crossfadeSafetyId) {
    clearTimeout(crossfadeSafetyId)
    crossfadeSafetyId = null
  }
  if (nextAudioEl) {
    nextAudioEl.pause()
    nextAudioEl.remove()
    nextAudioEl = null
  }
  if (nextSource) {
    try {
      nextSource.disconnect()
    } catch (_) {}
    nextSource = null
  }
  nextGain = null

  if (isPlaying && audioEl) audioEl.pause()
  stopVisualizer()
  if (audioContext) {
    audioContext.close().catch(() => {})
    audioContext = null
    source = null
    analyser = null
  }
  cleanupEQ()

  // Revoke old URLs and clear old audio
  playlist.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url)
  })
  playlist = []
  originalPlaylistOrder = null
  sortOriginalOrder = null
  currentSort = 'original'
  if (sortLabel) sortLabel.textContent = 'Original'
  if (sortDropdown) {
    sortDropdown.querySelectorAll('.pl-sort-option').forEach((o) => {
      o.classList.toggle('active', o.dataset.sort === 'original')
    })
  }

  // Build new playlist
  files.forEach((file, idx) => {
    const url = URL.createObjectURL(file)
    const name = file.name.replace(/\.[^/.]+$/, '')
    playlist.push({
      file,
      url,
      title: name,
      artist: 'Artista Desconhecido',
      album: '',
      duration: 0,
      picture: null,
      addedAt: Date.now(),
    })
  })

  // Show player screen
  uploadScreen.classList.add('hidden')
  playerScreen.classList.remove('hidden')
  // Defer resize so the browser has time to layout the player screen
  requestAnimationFrame(() => resizeCanvas())

  // Play first track
  if (playlist.length > 0) {
    playTrack(0)
  }

  // Extract metadata for all tracks (covers, titles, artists)
  extractAllTags()

  // Persist playlist to IndexedDB
  savePlaylistToDB()
}

let playTrackTimeoutId = null

// ========== PLAY TRACK BY INDEX ==========
function playTrack(index, autoPlay = true) {
  if (index < 0 || index >= playlist.length) return

  // Cancel any pending auto-play from a previous track switch
  if (playTrackTimeoutId) {
    clearTimeout(playTrackTimeoutId)
    playTrackTimeoutId = null
  }

  currentIndex = index
  const item = playlist[index]
  currentFile = item.file

  // Revoke previous URL if not in playlist
  if (currentFileUrl && !playlist.some((p) => p.url === currentFileUrl)) {
    URL.revokeObjectURL(currentFileUrl)
  }
  currentFileUrl = item.url

  // Stop current playback, crossfade, and close audio context
  crossfading = false
  // Cancel any pending crossfade timeouts from a previous crossfade
  if (crossfadeTimeoutId) {
    clearTimeout(crossfadeTimeoutId)
    crossfadeTimeoutId = null
  }
  if (crossfadeSafetyId) {
    clearTimeout(crossfadeSafetyId)
    crossfadeSafetyId = null
  }
  if (nextAudioEl) {
    nextAudioEl.pause()
    nextAudioEl.remove()
    nextAudioEl = null
  }
  if (nextSource) {
    try {
      nextSource.disconnect()
    } catch (_) {}
    nextSource = null
  }
  nextGain = null

  if (isPlaying && audioEl) {
    audioEl.pause()
  }
  stopVisualizer()
  if (audioContext) {
    audioContext.close().catch(() => {})
    audioContext = null
    source = null
    analyser = null
  }
  cleanupEQ()

  // Create fresh audio element
  audioEl = createAudioElement()
  attachAudioEvents(audioEl)

  audioEl.src = item.url
  audioEl.load()

  // Reset states
  isPlaying = false
  isMuted = false
  playBtn.classList.remove('playing')
  coverContainer.classList.remove('playing')
  updatePlayIcon(false)
  audioEl.volume = volumeBar.value / 100

  // Reset seek & time
  seekBar.value = 0
  updateRangeFill(seekBar)
  currentTime.textContent = '0:00'
  duration.textContent = '0:00'

  // Extract metadata and set cover
  extractMetadata(item.file)

  // If has cached cover, set it immediately
  if (item.picture) {
    setCoverImage(item.picture)
  } else {
    // Will be set by displayTags or setGradientCover
    setGradientCover()
  }

  // Update info display immediately
  songTitle.textContent = item.title
  songArtist.textContent = item.artist
  if (item.album) metaAlbum.textContent = item.album

  // Update playlist UI
  renderPlaylist()

  // Auto-play after creating fresh AudioContext (only if autoPlay is true)
  if (autoPlay) {
    playTrackTimeoutId = setTimeout(() => {
      playTrackTimeoutId = null
      togglePlay()
    }, 100)
  }
}

// ========== NEXT / PREV / REPEAT ==========
function getNextIndex() {
  if (playlist.length === 0) return -1
  if (repeatMode === 'one') return currentIndex
  if (shuffleMode) return getNextShuffleIndex()
  if (currentIndex < playlist.length - 1) return currentIndex + 1
  if (repeatMode === 'all') return 0
  return -1 // stop
}

function getPrevIndex() {
  if (playlist.length === 0) return -1
  if (shuffleMode) return getPrevShuffleIndex()
  if (currentIndex > 0) return currentIndex - 1
  if (repeatMode === 'all') return playlist.length - 1
  return 0
}

function nextTrack() {
  const next = getNextIndex()
  if (next === -1) return
  if (next === currentIndex && audioEl) {
    // repeat-one: reset and play
    audioEl.currentTime = 0
    if (!isPlaying) {
      if (!audioContext) setupAudioContext()
      else if (audioContext.state === 'suspended') audioContext.resume()
      audioEl.play().catch(() => {})
    }
    return
  }
  switchTrack(next)
}

function prevTrack() {
  if (playlist.length === 0) return
  // If more than 3 seconds in, restart current
  if (audioEl && audioEl.currentTime > 3) {
    audioEl.currentTime = 0
    return
  }
  const prev = getPrevIndex()
  if (prev === currentIndex || prev === -1) {
    if (audioEl) audioEl.currentTime = 0
    return
  }
  switchTrack(prev)
}

/** Switch to a track, using crossfade when possible */
function switchTrack(index) {
  if (index < 0 || index >= playlist.length || index === currentIndex) return

  // If a crossfade is already in progress, interrupt it immediately
  // (playTrack cleans up all crossfade state)
  if (crossfading) {
    playTrack(index)
    return
  }

  // Crossfade when audioContext is set up (works even if paused — for auto-advance)
  if (audioContext && crossfadeGain && playlist.length > 1) {
    crossfadeTo(index)
  } else {
    playTrack(index)
  }
}

function cycleRepeat() {
  const modes = ['none', 'all', 'one']
  const idx = modes.indexOf(repeatMode)
  repeatMode = modes[(idx + 1) % modes.length]
  updateRepeatUI()
  saveSettings()
}

function updateRepeatUI() {
  const btn = document.getElementById('repeat-btn')
  btn.classList.remove('repeat-all', 'repeat-one')
  if (repeatMode === 'all') {
    btn.classList.add('repeat-all')
    btn.title = 'Repetir todas'
  } else if (repeatMode === 'one') {
    btn.classList.add('repeat-one')
    btn.title = 'Repetir uma'
  } else {
    btn.title = 'Sem repetição'
  }
}

// ========== SHUFFLE ==========
function toggleShuffle() {
  shuffleMode = !shuffleMode
  const btn = document.getElementById('shuffle-btn')
  btn.classList.toggle('active', shuffleMode)
  btn.title = shuffleMode ? 'Aleatório: ativo' : 'Aleatório'

  if (shuffleMode) {
    // Generate shuffle order without modifying the playlist array
    generateShuffleOrder()
  } else {
    // Playlist was never reordered — just clear the shuffle order
    shuffleOrder = []
    originalPlaylistOrder = null
    renderPlaylist()
  }
  saveSettings()
}

function generateShuffleOrder() {
  // Create a shuffled array of indices (Fisher-Yates)
  shuffleOrder = []
  for (let i = 0; i < playlist.length; i++) {
    shuffleOrder.push(i)
  }
  // Fisher-Yates shuffle
  for (let i = shuffleOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]]
  }
  // Ensure current track is first in shuffle order
  const curIdx = shuffleOrder.indexOf(currentIndex)
  if (curIdx > 0) {
    ;[shuffleOrder[0], shuffleOrder[curIdx]] = [shuffleOrder[curIdx], shuffleOrder[0]]
  }
}

function getNextShuffleIndex() {
  if (shuffleOrder.length === 0) return -1
  // Find current position in shuffle order
  const pos = shuffleOrder.indexOf(currentIndex)
  if (pos === -1) return shuffleOrder[0]
  // Next in shuffle order
  const nextPos = pos + 1
  if (nextPos < shuffleOrder.length) return shuffleOrder[nextPos]
  // Reached end of shuffle order
  if (repeatMode === 'all') {
    generateShuffleOrder()
    return shuffleOrder[0]
  }
  return -1 // stop
}

function getPrevShuffleIndex() {
  if (shuffleOrder.length === 0) return -1
  const pos = shuffleOrder.indexOf(currentIndex)
  if (pos === -1) return shuffleOrder[0]
  const prevPos = pos - 1
  if (prevPos >= 0) return shuffleOrder[prevPos]
  if (repeatMode === 'all') return shuffleOrder[shuffleOrder.length - 1]
  return shuffleOrder[0]
}

// shufflePlaylist removed — shuffle uses shuffleOrder indices only,
// keeping the playlist array in its original order at all times.

// ========== CROSSFADE ==========
function crossfadeTo(index) {
  if (index < 0 || index >= playlist.length || index === currentIndex) return
  if (crossfading) return
  if (!audioContext || !crossfadeGain) {
    playTrack(index)
    return
  }

  crossfading = true
  const nextItem = playlist[index]

  // Update currentIndex early so playlist shows the correct active track
  currentIndex = index
  renderPlaylist()

  // Capture the current audio element to detect if playTrack() interrupts
  const prevAudioEl = audioEl

  // Create next audio element
  nextAudioEl = new Audio()
  nextAudioEl.preload = 'auto'
  nextAudioEl.src = nextItem.url
  nextAudioEl.crossOrigin = 'anonymous'
  nextAudioEl.load()

  const readyHandler = () => {
    // Guard: if playTrack() interrupted this crossfade (replaced audioEl or cleared state), abort
    if (!crossfading || !nextAudioEl || !audioContext || audioEl !== prevAudioEl) return
    try {
      // Create source and gain for the next track
      nextSource = audioContext.createMediaElementSource(nextAudioEl)
      nextGain = audioContext.createGain()
      nextGain.gain.value = 0

      // Connect into the same EQ chain
      const eqInput = eqFilters.bass
      if (!eqInput) throw new Error('EQ not ready')
      nextSource.connect(nextGain)
      nextGain.connect(eqInput)

      // Start playing silently
      nextAudioEl.play().catch(() => {})

      // Sync state immediately — the new audio is now playing
      // (handlers aren't attached yet, so 'play' event won't fire)
      isPlaying = true
      playBtn.classList.add('playing')
      coverContainer.classList.add('playing')
      updatePlayIcon(true)
      stopIdleLoop()
      if (!rafId) startVisualizer()

      // Schedule gain ramps — capped at user volume so combined
      // output never exceeds the configured level
      const now = audioContext.currentTime
      const dur = CROSSFADE_DURATION
      const userVol = volumeBar.value / 100

      crossfadeGain.gain.setValueAtTime(Math.min(crossfadeGain.gain.value, userVol), now)
      crossfadeGain.gain.linearRampToValueAtTime(0.001, now + dur)

      nextGain.gain.setValueAtTime(0, now)
      nextGain.gain.linearRampToValueAtTime(userVol, now + dur)

      // Update UI immediately to show the next track
      songTitle.textContent = nextItem.title
      songArtist.textContent = nextItem.artist
      currentTime.textContent = '0:00'
      seekBar.value = 0
      updateRangeFill(seekBar)

      if (nextItem.picture) {
        setCoverImage(nextItem.picture)
      } else {
        setGradientCover()
      }

      // After crossfade completes — capture refs for the guard check
      const fadeNextAudioEl = nextAudioEl
      const fadeIndex = index

      crossfadeTimeoutId = setTimeout(
        () => {
          crossfadeTimeoutId = null
          // Guard: if playTrack() interrupted this crossfade, skip cleanup
          if (nextAudioEl !== fadeNextAudioEl) return

          try {
            // Pause old audio
            if (audioEl && audioEl !== fadeNextAudioEl) {
              audioEl.pause()
            }

            // Disconnect old source and old gain
            if (source) {
              try {
                source.disconnect()
              } catch (_) {}
            }
            // Disconnect old gain node so it doesn't stay in the chain
            if (crossfadeGain && crossfadeGain !== nextGain) {
              try {
                crossfadeGain.disconnect()
              } catch (_) {}
            }

            // Replace references
            if (audioEl && audioEl !== fadeNextAudioEl) {
              audioEl.remove()
            }
            audioEl = fadeNextAudioEl
            audioEl.id = 'audio-element'
            audioEl.volume = volumeBar.value / 100
            audioContainer.appendChild(audioEl)

            // Attach events to the new audio element
            attachAudioEvents(audioEl)

            source = nextSource
            crossfadeGain = nextGain
            // Reset gain to 1 — volume is controlled by audioEl.volume
            crossfadeGain.gain.value = 1

            // Safety: re-sync state in case user paused during crossfade
            if (audioEl.paused) {
              isPlaying = false
              playBtn.classList.remove('playing')
              coverContainer.classList.remove('playing')
              updatePlayIcon(false)
            }

            // Update state (currentIndex already set at crossfade start)
            const newItem = playlist[fadeIndex]
            extractMetadata(newItem.file)
            renderPlaylist()
            applyEQFromSliders()

            // Ensure visualizer is running — the new audio is already playing
            // but attachAudioEvents won't fire 'play' on an already-playing element
            if (!rafId && isPlaying) {
              startVisualizer()
            }
          } catch (e) {
          } finally {
            nextAudioEl = null
            nextSource = null
            nextGain = null
            crossfading = false
          }
        },
        CROSSFADE_DURATION * 1000 + 300,
      )
    } catch (e) {
      crossfading = false
      playTrack(index)
    }
  }

  nextAudioEl.addEventListener('canplay', readyHandler, { once: true })

  // Safety timeout — store ID so it can be cancelled
  const safetyAudioEl = nextAudioEl
  crossfadeSafetyId = setTimeout(() => {
    crossfadeSafetyId = null
    // Guard: if playTrack() already cleaned up, or a new crossfade started, skip
    if (nextAudioEl !== safetyAudioEl) return
    if (crossfading) {
      safetyAudioEl.removeEventListener('canplay', readyHandler)
      crossfading = false
      playTrack(index)
    }
  }, 6000)
}

// ========== METADATA EXTRACTION ==========

/** Converte o picture do jsmediatags (Uint8Array, ArrayBuffer, Array ou string) em data URL */
function pictureToDataUrl(picture) {
  if (!picture) return null

  // Sanitiza o formato (vem de tags do arquivo — nunca confiar cegamente)
  const format = /^image\/[a-z0-9.+-]+$/i.test(picture.format || '') ? picture.format : 'image/jpeg'

  // Já veio pronto
  if (picture.base64 && !picture.data) {
    return `data:${format};base64,${picture.base64}`
  }

  const data = picture.data
  if (!data) return null

  try {
    let binary = ''
    if (typeof data === 'string') {
      // String já em formato binário (latin1)
      binary = data
    } else {
      // jsmediatags devolve Uint8Array; new Uint8Array() aceita Uint8Array,
      // ArrayBuffer e arrays comuns
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
    }
    if (!binary) return null

    const base64 = btoa(binary)
    return `data:${format};base64,${base64}`
  } catch (_) {
    return null
  }
}

/** Lê as tags de um arquivo via jsmediatags e devolve um objeto normalizado */
function readTags(file, onDone) {
  const result = {
    title: null,
    artist: null,
    album: null,
    year: null,
    genre: null,
    track: null,
    picture: null,
  }

  if (!window.jsmediatags) {
    onDone(result)
    return
  }

  jsmediatags.read(file, {
    onSuccess: (tagInfo) => {
      const tags = tagInfo.tags
      result.title = tags.title || null
      result.artist = tags.artist || null
      result.album = tags.album || null
      result.year = tags.year || null
      result.genre = tags.genre || null
      result.track = tags.track || null
      result.picture = pictureToDataUrl(tags.picture)
      onDone(result)
    },
    onError: () => onDone(result),
  })
}

/** Extrai metadados de todos os itens da playlist ainda não lidos (capa, título, artista, álbum) */
function extractAllTags() {
  if (!window.jsmediatags) return

  const pending = playlist.filter((item) => !item.tagsRead)
  if (pending.length === 0) return

  let remaining = pending.length

  pending.forEach((item) => {
    item.tagsRead = true

    readTags(item.file, (tags) => {
      // Ignora callbacks atrasados se a playlist mudou (ex.: track removido)
      if (playlist.includes(item)) {
        if (tags.title) item.title = tags.title
        if (tags.artist) item.artist = tags.artist
        if (tags.album) item.album = tags.album
        if (tags.picture) item.picture = tags.picture

        // Se a faixa virou a atual enquanto os dados chegavam, atualiza a UI
        if (item === playlist[currentIndex]) {
          displayTags(tags)
        }
      }

      remaining--
      if (remaining === 0) {
        renderPlaylist()
      }
    })
  })
}

function updateTechnicalMetadata(file) {
  // Try sample rate from AudioContext (more reliable)
  if (audioContext) {
    metaSamplerate.textContent = formatSampleRate(audioContext.sampleRate)
  }

  // Try to get format from file name
  const ext = file.name.split('.').pop().toUpperCase()
  metaFormat.textContent = ext || '—'

  // Duration
  metaDuration.textContent = formatTime(audioEl.duration)

  // Cache duration in playlist item (so playlist shows real duration)
  if (currentIndex >= 0 && currentIndex < playlist.length) {
    playlist[currentIndex].duration = audioEl.duration
    renderPlaylist()
  }

  // Try to estimate bitrate from file size and duration
  if (file.size && audioEl.duration) {
    const bitrateKbps = Math.round((file.size * 8) / (audioEl.duration * 1000))
    metaBitrate.textContent = bitrateKbps + ' kbps'
  }

  // Try channels via AudioContext destination
  if (audioContext) {
    const ch = audioContext.destination.maxChannelCount
    if (ch) {
      metaChannels.textContent = ch === 1 ? 'Mono' : ch === 2 ? 'Stereo' : ch + ' canais'
    }
  }

  extraMeta.classList.remove('hidden')
}

function extractMetadata(file) {
  // Marca como lido para o lote não ler de novo a faixa atual
  if (currentIndex >= 0 && currentIndex < playlist.length) {
    playlist[currentIndex].tagsRead = true
  }

  // Use jsmediatags for ID3 tags
  readTags(file, (tags) => {
    displayTags(tags)
  })

  // Extract technical info from audio element
  // If metadata is already loaded (e.g. after crossfade), update immediately
  if (audioEl && audioEl.readyState >= 1) {
    updateTechnicalMetadata(file)
  } else {
    audioEl.addEventListener(
      'loadedmetadata',
      () => {
        updateTechnicalMetadata(file)
      },
      { once: true },
    )
  }

  // File name as fallback title
  const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
  songTitle.textContent = nameWithoutExt
}

function displayTags(tags) {
  // Title
  if (tags.title) {
    songTitle.textContent = tags.title
  }

  // Artist
  if (tags.artist) {
    songArtist.textContent = tags.artist
  }

  // Album
  if (tags.album) {
    metaAlbum.textContent = tags.album
  }

  // Year
  if (tags.year) {
    metaYear.textContent = tags.year
  }

  // Genre
  if (tags.genre) {
    metaGenre.textContent = tags.genre
  }

  // Track number
  if (tags.track) {
    let trackStr = tags.track
    if (typeof trackStr === 'object' && trackStr.no) {
      trackStr = trackStr.no + (trackStr.of ? '/' + trackStr.of : '')
    }
    metaTrack.textContent = '#' + trackStr
  }

  // Cover art — tags.picture is already a data URL string from readTags()
  const imageUrl = tags.picture || null
  if (imageUrl) {
    setCoverImage(imageUrl)
    // Cache picture in playlist item
    if (currentIndex >= 0 && currentIndex < playlist.length) {
      playlist[currentIndex].picture = imageUrl
    }
  } else {
    setGradientCover()
  }

  // Cache metadata in playlist
  if (currentIndex >= 0 && currentIndex < playlist.length) {
    const item = playlist[currentIndex]
    if (tags.title) item.title = tags.title
    if (tags.artist) item.artist = tags.artist
    if (tags.album) item.album = tags.album
  }

  // Re-render playlist to update cached info
  renderPlaylist()

  // Show extra metadata
  extraMeta.classList.remove('hidden')
}

function setCoverImage(url) {
  coverArt.src = url
  coverArt.onload = () => {
    coverArt.style.display = 'block'
    // Set background
    bgCover.style.backgroundImage = `url(${url})`
    bgCover.classList.add('loaded')
  }
  coverArt.onerror = () => {
    // If cover image fails to load, fall back to gradient
    setGradientCover()
  }
}

function setGradientCover() {
  // Use cached theme accent colors for performance
  const { c1, c2 } = themeColors
  const grad = `linear-gradient(135deg, rgba(${c1.r},${c1.g},${c1.b},0.2), rgba(${c2.r},${c2.g},${c2.b},0.27))`
  coverContainer.style.background = grad
  coverArt.style.display = 'none'

  // For background, use the same gradient with blur
  bgCover.style.backgroundImage = `linear-gradient(135deg, rgb(${c1.r},${c1.g},${c1.b}), rgb(${c2.r},${c2.g},${c2.b}))`
  bgCover.classList.add('loaded')
}

// ========== AUDIO SETUP ==========
function setupAudioContext() {
  if (audioContext) {
    if (audioContext.state === 'suspended') {
      audioContext.resume()
    }
    return
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)()
  analyser = audioContext.createAnalyser()
  analyser.fftSize = 256

  try {
    source = audioContext.createMediaElementSource(audioEl)

    // Create crossfade gain node
    crossfadeGain = audioContext.createGain()
    crossfadeGain.gain.value = 1

    // Create EQ filters
    const bassFilter = audioContext.createBiquadFilter()
    bassFilter.type = 'lowshelf'
    bassFilter.frequency.value = 250
    bassFilter.gain.value = 0

    const midFilter = audioContext.createBiquadFilter()
    midFilter.type = 'peaking'
    midFilter.frequency.value = 1000
    midFilter.Q.value = 0.7
    midFilter.gain.value = 0

    const trebleFilter = audioContext.createBiquadFilter()
    trebleFilter.type = 'highshelf'
    trebleFilter.frequency.value = 4000
    trebleFilter.gain.value = 0

    // Store references
    eqFilters.bass = bassFilter
    eqFilters.mid = midFilter
    eqFilters.treble = trebleFilter

    // Connect: source → crossfadeGain → bass → mid → treble → analyser → destination
    source.connect(crossfadeGain)
    crossfadeGain.connect(bassFilter)
    bassFilter.connect(midFilter)
    midFilter.connect(trebleFilter)
    trebleFilter.connect(analyser)
    analyser.connect(audioContext.destination)

    // Apply current slider values
    applyEQFromSliders()

    const bufferLength = analyser.frequencyBinCount
    smoothData = new Float32Array(bufferLength)
  } catch (e) {}
}

// ========== EQUALIZER ==========
function applyEQFromSliders() {
  if (!audioContext || !eqFilters.bass) return
  eqFilters.bass.gain.value = parseFloat(document.getElementById('eq-bass').value)
  eqFilters.mid.gain.value = parseFloat(document.getElementById('eq-mid').value)
  eqFilters.treble.gain.value = parseFloat(document.getElementById('eq-treble').value)
}

function updateEQSlider(id, valId, fillId) {
  const slider = document.getElementById(id)
  const valDisplay = document.getElementById(valId)
  const fill = document.getElementById(fillId)
  const val = parseFloat(slider.value)

  valDisplay.textContent = (val > 0 ? '+' : '') + val + ' dB'

  // Update fill bar: center (0) is 50%, right is 100%, left is 0%
  const pct = 50 + (val / 12) * 50
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%'

  // Update filter if audio context is active
  if (audioContext && eqFilters.bass) {
    applyEQFromSliders()
  }
}

// Reset all EQ sliders to 0
function resetEQ() {
  ;['eq-bass', 'eq-mid', 'eq-treble'].forEach((id) => {
    document.getElementById(id).value = 0
    updateEQSlider(id, id + '-val', id + '-fill')
  })
  if (audioContext && eqFilters.bass) {
    applyEQFromSliders()
  }
  saveSettings()
}

// Close/disconnect EQ nodes and crossfade nodes (for cleanup)
function cleanupEQ() {
  eqFilters.bass = null
  eqFilters.mid = null
  eqFilters.treble = null
  crossfadeGain = null
  if (crossfadeTimeoutId) {
    clearTimeout(crossfadeTimeoutId)
    crossfadeTimeoutId = null
  }
  if (crossfadeSafetyId) {
    clearTimeout(crossfadeSafetyId)
    crossfadeSafetyId = null
  }
  if (nextSource) {
    try {
      nextSource.disconnect()
    } catch (_) {}
    nextSource = null
  }
  if (nextGain) {
    nextGain = null
  }
  if (nextAudioEl) {
    nextAudioEl.pause()
    nextAudioEl.remove()
    nextAudioEl = null
  }
  crossfading = false
}

// ========== EQ EVENT LISTENERS ==========
;['bass', 'mid', 'treble'].forEach((band) => {
  const slider = document.getElementById('eq-' + band)
  slider.addEventListener('input', () => {
    updateEQSlider('eq-' + band, 'eq-' + band + '-val', 'eq-' + band + '-fill')
    saveSettings()
  })
})

const eqToggleBtn = document.getElementById('eq-toggle-btn')
const eqModal = document.getElementById('eq-modal')
const eqCloseBtn = document.getElementById('eq-close')
const eqOverlay = document.getElementById('eq-overlay')
const eqResetBtn = document.getElementById('eq-reset-btn')

eqToggleBtn.addEventListener('click', () => {
  openEQModal()
})

eqCloseBtn.addEventListener('click', closeEQModal)
eqOverlay.addEventListener('click', closeEQModal)
eqResetBtn.addEventListener('click', () => {
  resetEQ()
})

function openEQModal() {
  eqOpen = true
  eqModal.classList.remove('hidden')
  eqToggleBtn.classList.add('active')
  // Update fills on open in case they were set while closed
  ;['bass', 'mid', 'treble'].forEach((band) => {
    updateEQSlider('eq-' + band, 'eq-' + band + '-val', 'eq-' + band + '-fill')
  })
}

function closeEQModal() {
  eqOpen = false
  eqModal.classList.add('hidden')
  eqToggleBtn.classList.remove('active')
}

// Initialize EQ value displays and fills
;['bass', 'mid', 'treble'].forEach((band) => {
  updateEQSlider('eq-' + band, 'eq-' + band + '-val', 'eq-' + band + '-fill')
})

// ========== STOP VISUALIZER ==========
function stopVisualizer() {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  // Clear particles when stopping
  particles = []
  spawnAccumulator = 0
  bassThreshold = 0
  lastFrameTime = 0
  // Resume idle loop
  if (!idleRaf) {
    startIdleLoop()
  }
}

// ========== PLAYBACK CONTROLS ==========
function togglePlay() {
  if (!audioEl || !audioEl.src) return

  if (isPlaying) {
    audioEl.pause()
  } else {
    if (!audioContext) {
      setupAudioContext()
    } else if (audioContext.state === 'suspended') {
      audioContext.resume()
    }
    audioEl.play().catch(() => {})
  }
}

// We attach events dynamically to the current audioEl
function attachAudioEvents(el) {
  el.addEventListener('play', () => {
    // Guard: only handle events from the current audio element
    if (el !== audioEl && el !== nextAudioEl) return
    isPlaying = true
    playBtn.classList.add('playing')
    coverContainer.classList.add('playing')
    updatePlayIcon(true)
    // Stop idle, start visualizer
    stopIdleLoop()
    if (!rafId) startVisualizer()
  })

  el.addEventListener('pause', () => {
    // Guard: only handle events from the current audio element
    if (el !== audioEl && el !== nextAudioEl) return
    isPlaying = false
    playBtn.classList.remove('playing')
    coverContainer.classList.remove('playing')
    updatePlayIcon(false)
    // Stop visualizer, resume idle drawing — but skip during crossfade
    // (the new audio is still playing, visualizer should keep running)
    if (!crossfading) {
      stopVisualizer()
    }
  })

  el.addEventListener('ended', () => {
    // Guard: only handle events from the current audio element
    if (el !== audioEl) return
    // If crossfading already handled the transition, just clean up
    if (crossfading) return

    isPlaying = false
    playBtn.classList.remove('playing')
    coverContainer.classList.remove('playing')
    updatePlayIcon(false)
    seekBar.value = 0
    updateRangeFill(seekBar)
    currentTime.textContent = '0:00'
    stopVisualizer()

    // Auto-advance to next track
    // If crossfade is available, advance immediately (crossfade handles the transition)
    // Otherwise use a short delay for a smoother feel
    if (playlist.length > 0) {
      const useCrossfade = audioContext && crossfadeGain && playlist.length > 1
      setTimeout(() => nextTrack(), useCrossfade ? 0 : 300)
    }
  })

  // Per-track flag to trigger crossfade only once
  let crossfadeTriggered = false

  el.addEventListener('timeupdate', () => {
    // Guard: ignore events from old/detached audio elements
    if (el !== audioEl) return
    if (el.duration) {
      // Skip seek updates while user is dragging to avoid flickering
      if (!seekDragging) {
        seekBar.value = (el.currentTime / el.duration) * 100
        updateRangeFill(seekBar)
        currentTime.textContent = formatTime(el.currentTime)
      }
    }

    // Auto-trigger crossfade near the end of the track
    if (
      isPlaying &&
      !crossfading &&
      !crossfadeTriggered &&
      el.duration &&
      el.currentTime > 0 &&
      playlist.length > 1 &&
      el.duration - el.currentTime <= CROSSFADE_DURATION
    ) {
      crossfadeTriggered = true
      const next = getNextIndex()
      if (next !== -1 && next !== currentIndex) {
        switchTrack(next)
      }
    }
  })

  el.addEventListener('loadedmetadata', () => {
    // Guard: only update UI for the current audio element
    if (el !== audioEl) return
    duration.textContent = formatTime(el.duration)
    updateRangeFill(seekBar)
  })
}

function updatePlayIcon(playing) {
  const playIcon = document.getElementById('play-icon')
  const pauseIcon1 = document.getElementById('pause-icon')
  const pauseIcon2 = document.getElementById('pause-icon2')

  if (playing) {
    playIcon.classList.add('hidden')
    pauseIcon1.classList.remove('hidden')
    pauseIcon2.classList.remove('hidden')
  } else {
    playIcon.classList.remove('hidden')
    pauseIcon1.classList.add('hidden')
    pauseIcon2.classList.add('hidden')
  }
}

playBtn.addEventListener('click', togglePlay)

// ========== PLAYLIST CONTROLS ==========
document.getElementById('prev-btn').addEventListener('click', prevTrack)
document.getElementById('next-btn').addEventListener('click', nextTrack)
document.getElementById('repeat-btn').addEventListener('click', cycleRepeat)
document.getElementById('shuffle-btn').addEventListener('click', toggleShuffle)

// ========== THEME COLORS (must be before applyTheme) ==========
/** Parse a hex color string to {r,g,b} */
function hexToRgb(hex) {
  const val = parseInt(hex.replace('#', ''), 16)
  return { r: (val >> 16) & 255, g: (val >> 8) & 255, b: val & 255 }
}

// Cached theme colors for visualizer performance
let themeColors = {
  c1: { r: 0, g: 212, b: 255 },
  c2: { r: 123, g: 47, b: 247 },
  c3: { r: 255, g: 45, b: 149 },
}

function updateThemeColorCache() {
  const style = getComputedStyle(document.documentElement)
  themeColors.c1 = hexToRgb(style.getPropertyValue('--accent-1').trim() || '#00d4ff')
  themeColors.c2 = hexToRgb(style.getPropertyValue('--accent-2').trim() || '#7b2ff7')
  themeColors.c3 = hexToRgb(style.getPropertyValue('--accent-3').trim() || '#ff2d95')
}

// ========== THEME SYSTEM ==========
function refreshThemeElements() {
  // Recreate upload particles with new theme colors
  createParticles()
}

function applyTheme(theme) {
  // Remove all theme classes from html
  document.documentElement.classList.remove(
    'theme-neon',
    'theme-forest',
    'theme-sunset',
    'theme-ocean',
    'theme-lavender',
  )
  document.documentElement.classList.add('theme-' + theme)
  localStorage.setItem('audize-theme', theme)
  // Also persist in the unified settings object
  try {
    const raw = localStorage.getItem('audize-settings')
    const s = raw ? JSON.parse(raw) : {}
    s.theme = theme
    localStorage.setItem('audize-settings', JSON.stringify(s))
  } catch (_) {}

  // Update dropdown active state
  document.querySelectorAll('.theme-option').forEach((opt) => {
    const isActive = opt.dataset.theme === theme
    opt.classList.toggle('active', isActive)
  })

  // Update theme color cache for visualizer
  updateThemeColorCache()
  // Refresh elements that depend on computed CSS variables
  refreshThemeElements()
  // Update cover gradient if the current song has no embedded cover
  // (needs new theme colors). Usa o picture cacheado no item da playlist,
  // não o .src do <img> (que sempre resolve para uma URL completa).
  const currentItem = currentIndex >= 0 ? playlist[currentIndex] : null
  if (!currentItem || !currentItem.picture) {
    setGradientCover()
  }

  // Refreshes the seek/volume fills with the new theme accent
  updateRangeFill(seekBar)
  updateRangeFill(volumeBar)
}

// Load saved theme (new settings format, fallback to old key)
let savedTheme = 'neon'
try {
  const raw = localStorage.getItem('audize-settings')
  if (raw) {
    const s = JSON.parse(raw)
    if (s.theme) savedTheme = s.theme
  }
  if (savedTheme === 'neon') {
    savedTheme = localStorage.getItem('audize-theme') || 'neon'
  }
} catch (_) {}
applyTheme(savedTheme)

// Theme button + dropdown
document.getElementById('theme-btn').addEventListener('click', (e) => {
  e.stopPropagation()
  document.getElementById('theme-dropdown').classList.toggle('open')
})

document.querySelectorAll('.theme-option').forEach((opt) => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation()
    applyTheme(opt.dataset.theme)
    document.getElementById('theme-dropdown').classList.remove('open')
  })
})

// Close theme dropdown on click outside
document.addEventListener('click', (e) => {
  const dd = document.getElementById('theme-dropdown')
  if (
    dd &&
    dd.classList.contains('open') &&
    !e.target.closest('#theme-btn') &&
    !e.target.closest('.theme-dropdown')
  ) {
    dd.classList.remove('open')
  }
})

// Keyboard shortcuts

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

  const isPlayerVisible = !playerScreen.classList.contains('hidden')
  const shortcutsModal = document.getElementById('shortcuts-modal')
  const modalOpen = shortcutsModal && !shortcutsModal.classList.contains('hidden')

  // NEVER block browser shortcuts (Ctrl/Cmd + any key)
  if (e.ctrlKey || e.metaKey) return

  // Check EQ modal state
  const eqModalOpen = eqModal && !eqModal.classList.contains('hidden')

  // Escape closes modals/dropdowns first
  if (e.key === 'Escape') {
    // Close confirm modal if open
    if (!confirmModal.classList.contains('hidden')) {
      closeConfirm(false)
      e.preventDefault()
      return
    }
    // Close theme dropdown if open
    const themeDD = document.getElementById('theme-dropdown')
    if (themeDD && themeDD.classList.contains('open')) {
      themeDD.classList.remove('open')
      e.preventDefault()
      return
    }
    if (eqModalOpen) {
      closeEQModal()
      e.preventDefault()
      return
    }
    if (modalOpen) {
      closeShortcutsModal()
      e.preventDefault()
      return
    }
  }

  // Toggle shortcuts modal with ? (must be before the modal guard)
  if (e.code === 'Slash' && e.shiftKey && isPlayerVisible) {
    e.preventDefault()
    toggleShortcutsModal()
    return
  }

  // Toggle EQ modal with E (must be before the modal guard)
  if (e.code === 'KeyE' && isPlayerVisible) {
    e.preventDefault()
    if (eqOpen) closeEQModal()
    else openEQModal()
    return
  }

  // If modal is open, block all other shortcuts
  if (modalOpen || eqModalOpen) return

  switch (e.code) {
    case 'Space':
      e.preventDefault()
      if (isPlayerVisible) {
        togglePlay()
      } else {
        fileInput.click()
      }
      break

    case 'ArrowRight':
      e.preventDefault()
      if (isPlayerVisible) nextTrack()
      break

    case 'ArrowLeft':
      e.preventDefault()
      if (isPlayerVisible) prevTrack()
      break

    case 'KeyR':
      if (isPlayerVisible) {
        e.preventDefault()
        cycleRepeat()
      }
      break

    case 'KeyS':
      if (isPlayerVisible) {
        e.preventDefault()
        toggleShuffle()
      }
      break
  }
})

// ========== SHORTCUTS MODAL ==========
function toggleShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal')
  modal.classList.toggle('hidden')
}

function openShortcutsModal() {
  document.getElementById('shortcuts-modal').classList.remove('hidden')
}

function closeShortcutsModal() {
  document.getElementById('shortcuts-modal').classList.add('hidden')
}

document.getElementById('shortcuts-btn').addEventListener('click', toggleShortcutsModal)
document.getElementById('shortcuts-close').addEventListener('click', closeShortcutsModal)
document.getElementById('shortcuts-overlay').addEventListener('click', closeShortcutsModal)

// ========== RANGE FILL (WebKit) ==========
function updateRangeFill(el) {
  const min = parseFloat(el.min) || 0
  const max = parseFloat(el.max) || 100
  const val = parseFloat(el.value)
  const pct = ((val - min) / (max - min)) * 100

  // Follows the active theme accent (usa o cache de cores, sem ler estilos por chamada)
  const { r, g, b } = themeColors.c1
  el.style.background = `linear-gradient(to right, rgb(${r}, ${g}, ${b}) ${pct}%, rgba(255,255,255,0.1) ${pct}%)`
}

// ========== SEEK & VOLUME ==========
seekBar.addEventListener('input', () => {
  seekDragging = true
  updateRangeFill(seekBar)
  // Update visual display only while dragging
  if (audioEl && audioEl.duration) {
    const time = (seekBar.value / 100) * audioEl.duration
    currentTime.textContent = formatTime(time)
  }
})

// Seek audio only when user releases the mouse
seekBar.addEventListener('change', () => {
  seekDragging = false
  if (audioEl && audioEl.duration) {
    const time = (seekBar.value / 100) * audioEl.duration
    audioEl.currentTime = time
    // Resume playback if paused
    if (!isPlaying) {
      if (!audioContext) setupAudioContext()
      else if (audioContext.state === 'suspended') audioContext.resume()
      audioEl.play().catch(() => {})
    }
  }
})

volumeBar.addEventListener('input', () => {
  updateRangeFill(volumeBar)
  const vol = volumeBar.value / 100
  if (audioEl) audioEl.volume = vol
  // Also update the next track during crossfade
  if (crossfading && nextAudioEl) nextAudioEl.volume = vol
  updateMuteIcon()
})

muteBtn.addEventListener('click', () => {
  if (!audioEl) return
  isMuted = !isMuted
  audioEl.muted = isMuted
  updateMuteIcon()
})

function updateMuteIcon() {
  const volWave1 = document.getElementById('vol-wave1')
  const volWave2 = document.getElementById('vol-wave2')
  const muteLine = document.getElementById('vol-mute')

  if (!audioEl) return
  if (isMuted || audioEl.volume === 0) {
    volWave1.style.display = 'none'
    volWave2.style.display = 'none'
    muteLine.classList.remove('hidden')
  } else {
    volWave1.style.display = 'block'
    volWave2.style.display = 'block'
    muteLine.classList.add('hidden')
  }
}

// ========== REMOVE TRACK FROM PLAYLIST ==========
function removeTrack(index) {
  if (playlist.length === 0) return

  const wasCurrent = currentIndex === index
  const wasPlayingBefore = isPlaying

  // Revoke URL
  if (playlist[index].url) {
    URL.revokeObjectURL(playlist[index].url)
  }

  playlist.splice(index, 1)

  if (playlist.length === 0) {
    // No more songs - clean up and go back to upload screen
    if (isPlaying && audioEl) audioEl.pause()
    stopVisualizer()
    if (audioContext) {
      audioContext.close().catch(() => {})
      audioContext = null
      source = null
      analyser = null
    }
    cleanupEQ()
    isPlaying = false
    playBtn.classList.remove('playing')
    coverContainer.classList.remove('playing')
    updatePlayIcon(false)
    playerScreen.classList.add('hidden')
    uploadScreen.classList.remove('hidden')
    startIdleLoop()
    // Clear DB since playlist is now empty
    savePlaylistToDB()
    return
  }

  // Adjust currentIndex
  if (wasCurrent) {
    if (index >= playlist.length) {
      currentIndex = playlist.length - 1
    } else {
      currentIndex = index
    }
    // Only auto-play if the user was playing before the removal
    playTrack(currentIndex, wasPlayingBefore)
  } else if (index < currentIndex) {
    currentIndex--
    renderPlaylist()
  } else {
    renderPlaylist()
  }

  // Update shuffleOrder: remove the deleted index and shift higher indices down
  if (shuffleMode && shuffleOrder.length > 0) {
    shuffleOrder = shuffleOrder
      .filter((idx) => idx !== index)
      .map((idx) => (idx > index ? idx - 1 : idx))
    // Ensure currentIndex is still reachable
    if (shuffleOrder.length > 0 && !shuffleOrder.includes(currentIndex)) {
      shuffleOrder.push(currentIndex)
    }
  }

  // Persist updated playlist
  savePlaylistToDB()
}

// ========== PLAYLIST SORT STATE ==========
let currentSort = 'original'
let sortOriginalOrder = null // Snapshot before sorting

function sortPlaylist(sortType) {
  // Save original order on first sort
  if (!sortOriginalOrder) {
    sortOriginalOrder = playlist.map((item) => ({ ...item }))
  }

  if (sortType === 'original') {
    playlist = sortOriginalOrder.map((item) => ({ ...item }))
    sortOriginalOrder = null
  } else {
    // Always sort from the saved original order
    const source = sortOriginalOrder || playlist
    const sorted = source.map((item) => ({ ...item }))

    sorted.sort((a, b) => {
      switch (sortType) {
        case 'title-asc':
          return a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' })
        case 'title-desc':
          return b.title.localeCompare(a.title, 'pt-BR', { sensitivity: 'base' })
        case 'duration-asc':
          return (a.duration || 0) - (b.duration || 0)
        case 'duration-desc':
          return (b.duration || 0) - (a.duration || 0)
        case 'date-asc':
          return (a.addedAt || 0) - (b.addedAt || 0)
        case 'date-desc':
          return (b.addedAt || 0) - (a.addedAt || 0)
        default:
          return 0
      }
    })

    playlist = sorted
  }

  // Preserve currentIndex by finding the currently playing track in the new order
  if (currentIndex >= 0 && currentIndex < playlist.length) {
    const currentItem = playlist[currentIndex]
    // Find the item by file reference since sort creates new objects
    const idx = playlist.findIndex((p) => p.file === currentItem.file)
    if (idx !== -1) currentIndex = idx
  } else if (playlist.length > 0) {
    currentIndex = 0
  }

  currentSort = sortType

  // If shuffle is active, the playlist was reordered — regenerate shuffleOrder
  // so indices match the new playlist positions
  if (shuffleMode && shuffleOrder.length > 0) {
    generateShuffleOrder()
  }

  renderPlaylist()
  saveSettings()
}

// ========== PLAYLIST FILTER STATE ==========
let playlistFilter = ''

// ========== RENDER PLAYLIST ==========
function renderPlaylist() {
  const list = document.getElementById('playlist-list')
  const countSpan = document.getElementById('playlist-count')
  const section = document.getElementById('playlist-section')
  const container = document.getElementById('playlist-container')
  const searchInput = document.getElementById('playlist-search-input')
  const clearBtn = document.getElementById('pl-search-clear')

  if (playlist.length === 0) {
    section.classList.add('hidden')
    return
  }

  section.classList.remove('hidden')

  // Filter playlist items
  const filter = playlistFilter.toLowerCase().trim()

  // When shuffle is active, iterate in shuffle order so the list reflects
  // the actual playback sequence. Otherwise use natural array order.
  const orderedIndices =
    shuffleMode && shuffleOrder.length > 0 ? shuffleOrder.slice() : playlist.map((_, idx) => idx)

  const filtered = filter
    ? orderedIndices
        .map((idx) => ({ item: playlist[idx], idx }))
        .filter(
          ({ item }) =>
            item.title.toLowerCase().includes(filter) ||
            item.artist.toLowerCase().includes(filter) ||
            (item.album && item.album.toLowerCase().includes(filter)),
        )
    : orderedIndices.map((idx) => ({ item: playlist[idx], idx }))

  const visibleCount = filtered.length
  countSpan.textContent =
    playlist.length +
    ' música' +
    (playlist.length > 1 ? 's' : '') +
    (filter ? ` (${visibleCount} encontrada${visibleCount !== 1 ? 's' : ''})` : '')

  // Show/hide clear button
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !filter)
  }

  // Mantém o estado atual da playlist (aberta por padrão, mas respeita fechamento manual)
  if (playlistOpen) {
    playlistToggle.classList.add('open')
    playlistContainer.classList.add('open')
  }

  list.innerHTML = ''

  if (filtered.length === 0) {
    const emptyMsg = document.createElement('div')
    emptyMsg.className = 'pl-search-empty'
    emptyMsg.textContent = 'Nenhuma música encontrada para "' + playlistFilter + '"'
    list.appendChild(emptyMsg)
    return
  }

  filtered.forEach(({ item, idx }, displayPos) => {
    const isActive = idx === currentIndex
    const div = document.createElement('div')
    div.className = 'playlist-item' + (isActive ? ' active' : '')
    div.dataset.index = idx

    const dur = item.duration ? formatTime(item.duration) : '--:--'
    // Show shuffle sequence number when active, otherwise array position
    const itemNum = shuffleMode && shuffleOrder.length > 0 ? displayPos + 1 : idx + 1

    // Highlight matching text if filtering
    const titleHtml = filter ? highlightMatch(item.title, filter) : escapeHtml(item.title)
    const artistHtml = filter ? highlightMatch(item.artist, filter) : escapeHtml(item.artist)

    const delBtn = document.createElement('button')
    delBtn.className = 'pl-item-del'
    delBtn.title = 'Remover da playlist'
    delBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>'
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      removeTrack(idx)
    })

    const coverHtml = item.picture
      ? `<img class="pl-item-cover-img" src="${escapeHtml(item.picture)}" alt="" loading="lazy" />`
      : ''

    div.innerHTML = `
            <span class="pl-item-num">${itemNum}</span>
            <div class="pl-item-playing">
                <div class="pl-bars">
                    <span></span><span></span><span></span>
                </div>
            </div>
            <div class="pl-item-cover">${coverHtml}</div>
            <div class="pl-item-info">
                <div class="pl-item-title">${titleHtml}</div>
                <div class="pl-item-artist">${artistHtml}</div>
            </div>
            <span class="pl-item-dur">${dur}</span>
        `
    div.appendChild(delBtn)

    div.addEventListener('click', (e) => {
      if (e.target.closest('.pl-item-del')) return
      if (idx === currentIndex) {
        togglePlay()
      } else {
        playTrack(idx)
      }
    })

    list.appendChild(div)
  })
}

/** Highlight matching portion of text with safe HTML escaping */
function highlightMatch(text, filter) {
  const escapedFilter = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escapedFilter, 'gi')
  let result = '',
    last = 0,
    match
  while ((match = regex.exec(text)) !== null) {
    result += escapeHtml(text.slice(last, match.index))
    result += '<mark class="pl-match">' + escapeHtml(match[0]) + '</mark>'
    last = regex.lastIndex
  }
  result += escapeHtml(text.slice(last))
  return result || escapeHtml(text)
}

// ========== PLAYLIST SEARCH EVENT LISTENERS ==========
const playlistSearchInput = document.getElementById('playlist-search-input')
const playlistSearchClear = document.getElementById('pl-search-clear')

if (playlistSearchInput) {
  playlistSearchInput.addEventListener('input', () => {
    playlistFilter = playlistSearchInput.value
    renderPlaylist()
  })

  // Escape key to clear filter
  playlistSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      playlistSearchInput.value = ''
      playlistFilter = ''
      renderPlaylist()
      playlistSearchInput.blur()
    }
  })
}

if (playlistSearchClear) {
  playlistSearchClear.addEventListener('click', () => {
    playlistSearchInput.value = ''
    playlistFilter = ''
    renderPlaylist()
    playlistSearchInput.focus()
  })
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ========== SORT DROPDOWN EVENTS ==========
const sortBtn = document.getElementById('sort-btn')
const sortDropdown = document.getElementById('sort-dropdown')
const sortLabel = document.getElementById('sort-label')
const sortWrap = sortBtn?.closest('.pl-sort-wrap')

const sortLabels = {
  original: 'Original',
  'title-asc': 'A→Z',
  'title-desc': 'Z→A',
  'duration-asc': 'Curta→Longa',
  'duration-desc': 'Longa→Curta',
  'date-asc': 'Mais antigos',
  'date-desc': 'Mais recentes',
}

if (sortBtn) {
  sortBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    sortDropdown.classList.toggle('hidden')
    sortWrap?.classList.toggle('open')
  })
}

if (sortDropdown) {
  sortDropdown.addEventListener('click', (e) => {
    e.stopPropagation()
    const option = e.target.closest('.pl-sort-option')
    if (!option) return
    const sortType = option.dataset.sort
    // Update active state
    sortDropdown.querySelectorAll('.pl-sort-option').forEach((o) => o.classList.remove('active'))
    option.classList.add('active')
    // Update label
    sortLabel.textContent = sortLabels[sortType] || 'Original'
    // Close dropdown
    sortDropdown.classList.add('hidden')
    sortWrap?.classList.remove('open')
    // Apply sort
    sortPlaylist(sortType)
  })
}

// Close sort dropdown on outside click
document.addEventListener('click', () => {
  if (sortDropdown && !sortDropdown.classList.contains('hidden')) {
    sortDropdown.classList.add('hidden')
    sortWrap?.classList.remove('open')
  }
})

// Playlist toggle
const playlistToggle = document.getElementById('playlist-toggle')
const playlistContainer = document.getElementById('playlist-container')
let playlistOpen = true

playlistToggle.addEventListener('click', () => {
  playlistOpen = !playlistOpen
  playlistToggle.classList.toggle('open', playlistOpen)
  playlistContainer.classList.toggle('open', playlistOpen)
})

// ========== ADD FILES (append to playlist) ==========
function addFiles(files) {
  const audioFiles = Array.from(files).filter((f) => f.type.startsWith('audio/'))
  if (audioFiles.length === 0) return

  // Ensure player screen is visible
  if (!playerScreen.classList.contains('hidden') || playlist.length > 0) {
    // Already on player screen or has playlist — just append
    audioFiles.forEach((file) => {
      const url = URL.createObjectURL(file)
      const name = file.name.replace(/\.[^/.]+$/, '')
      playlist.push({
        file,
        url,
        title: name,
        artist: 'Artista Desconhecido',
        album: '',
        duration: 0,
        picture: null,
        addedAt: Date.now(),
      })
    })
    // Reset sort so new tracks appear at the end
    if (currentSort !== 'original') {
      currentSort = 'original'
      sortOriginalOrder = null
      if (sortLabel) sortLabel.textContent = 'Original'
      if (sortDropdown) {
        sortDropdown.querySelectorAll('.pl-sort-option').forEach((o) => {
          o.classList.toggle('active', o.dataset.sort === 'original')
        })
      }
    }
    // If shuffle is active, append new track indices to shuffleOrder
    if (shuffleMode && shuffleOrder.length > 0) {
      const startIdx = playlist.length - audioFiles.length
      for (let i = startIdx; i < playlist.length; i++) {
        shuffleOrder.push(i)
      }
    }

    renderPlaylist()
    // Extract metadata for the new tracks (covers, titles, artists)
    extractAllTags()
    savePlaylistToDB()
    return
  }

  // If no playlist yet, do a fresh load
  loadFiles(audioFiles)
}

// ========== BACK BUTTON ==========
backBtn.addEventListener('click', () => {
  // Open file picker to add more music to the current playlist
  fileInput.click()
})

// ========== TIME FORMATTING ==========
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatSampleRate(rate) {
  rate = parseInt(rate)
  if (!rate) return '—'
  return (rate / 1000).toFixed(1) + ' kHz'
}

// =============================================
//   PARTICLE SYSTEM
// =============================================

let particles = []
const MAX_PARTICLES = 250
let bassThreshold = 0 // smoothed bass energy
let spawnAccumulator = 0

/** Get a color interpolated between the theme accent colors by position (0-1) */
function getBarColor(normalizedPos) {
  const { c1, c2, c3 } = themeColors
  let r, g, b
  if (normalizedPos < 0.5) {
    const t = normalizedPos / 0.5
    r = Math.round(c1.r + t * (c2.r - c1.r))
    g = Math.round(c1.g + t * (c2.g - c1.g))
    b = Math.round(c1.b + t * (c2.b - c1.b))
  } else {
    const t = (normalizedPos - 0.5) / 0.5
    r = Math.round(c2.r + t * (c3.r - c2.r))
    g = Math.round(c2.g + t * (c3.g - c2.g))
    b = Math.round(c2.b + t * (c3.b - c2.b))
  }
  return { r, g, b }
}

/** Spawn a single particle at the bottom of the canvas */
function spawnParticle(w, h, energy, bassBoost) {
  if (particles.length >= MAX_PARTICLES) return
  if (!w || !h) return // don't spawn on invalid canvas

  const huePos = Math.random()
  const color = getBarColor(huePos)

  // Spawn position: spread across bottom area
  const x = Math.random() * w
  const y = h - 5 + (Math.random() - 0.5) * 20

  // Velocity: upward with some horizontal spread
  const speed = 0.5 + energy * 3 + bassBoost * 4
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8

  const size = 1.5 + energy * 4 + bassBoost * 3
  const life = 0.6 + energy * 1.2 + Math.random() * 0.5

  const pIntensity = Math.min(1, energy * 1.2)

  particles.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: Math.min(size, 8),
    alpha: 0.3 + pIntensity * 0.5,
    decay: 0.6 + Math.random() * 0.4,
    life,
    maxLife: life,
    color,
    // Slight rotation for visual variety
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.1,
  })
}

/** Spawn a burst of particles from a specific point (bass hit) */
function spawnBurst(x, y, intensity, w, h) {
  if (!w || !h) return // don't spawn on invalid canvas
  const count = Math.round(4 + intensity * 16)
  for (let i = 0; i < count; i++) {
    if (particles.length >= MAX_PARTICLES) break
    const huePos = Math.random()
    const color = getBarColor(huePos)
    const angle = Math.random() * Math.PI * 2
    const speed = 1 + intensity * 5 + Math.random() * 2
    const life = 0.5 + intensity * 1.0 + Math.random() * 0.3

    particles.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      size: 1.5 + intensity * 3 + Math.random() * 2,
      alpha: 0.5 + intensity * 0.4,
      decay: 0.5 + Math.random() * 0.3,
      life,
      maxLife: life,
      color,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.15,
    })
  }
}

/** Update all particles and remove dead ones */
function updateParticles(dt) {
  const w = canvas.width
  const h = canvas.height
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.x += p.vx
    p.y += p.vy
    // Slow down
    p.vx *= 0.98
    p.vy *= 0.98
    // Stronger gravity pull — prevents particles from escaping upward
    p.vy += 0.12
    p.rot += p.rotSpeed
    p.life -= dt * p.decay
    // Fade out
    if (p.life < p.maxLife * 0.3) {
      p.alpha = Math.max(0, p.alpha - dt * 0.8)
    }
    // Remove if dead or out of bounds (top, bottom, left, right)
    // Also clamp y so particles never get permanently stuck above the canvas
    if (p.y < -10) {
      particles.splice(i, 1)
      continue
    }
    if (p.life <= 0 || p.alpha <= 0 || p.y > h + 20 || p.x < -20 || p.x > w + 20) {
      particles.splice(i, 1)
    }
  }
}

/** Draw all particles on the canvas */
function drawParticles(ctx, w, h) {
  for (const p of particles) {
    // Skip particles that are outside the canvas bounds
    if (p.y < -5 || p.y > h + 5 || p.x < -5 || p.x > w + 5) continue
    const lifeRatio = Math.max(0, p.life / p.maxLife)
    const alpha = p.alpha * lifeRatio
    if (alpha <= 0.01) continue

    const { r, g, b } = p.color

    // Glow
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 0.6})`
    ctx.shadowBlur = p.size * 4

    // Draw as small circle or diamond
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot)

    // Star/diamond shape for larger particles, circle for smaller
    if (p.size > 3) {
      // Diamond shape
      const s = p.size * 0.6
      ctx.beginPath()
      ctx.moveTo(0, -s)
      ctx.lineTo(s * 0.7, 0)
      ctx.lineTo(0, s)
      ctx.lineTo(-s * 0.7, 0)
      ctx.closePath()
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
      ctx.fill()
      // Inner highlight
      ctx.beginPath()
      ctx.moveTo(0, -s * 0.5)
      ctx.lineTo(s * 0.35, 0)
      ctx.lineTo(0, s * 0.5)
      ctx.lineTo(-s * 0.35, 0)
      ctx.closePath()
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.3})`
      ctx.fill()
    } else {
      // Circle
      ctx.beginPath()
      ctx.arc(0, 0, p.size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
      ctx.fill()
      // Bright center
      ctx.beginPath()
      ctx.arc(0, 0, p.size * 0.4, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.5})`
      ctx.fill()
    }

    ctx.restore()
  }

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
}

// ========== VISUALIZER ==========
function startVisualizer() {
  if (!analyser) return
  if (rafId) cancelAnimationFrame(rafId)
  lastFrameTime = 0
  rotationAngle = 0
  stopIdleLoop()
  rafId = requestAnimationFrame(drawVisualizer)
}

let lastFrameTime = 0
let rotationAngle = 0

function drawVisualizer(timestamp) {
  rafId = requestAnimationFrame(drawVisualizer)

  if (!analyser || !ctx || !canvas.width) return

  if (!lastFrameTime) lastFrameTime = timestamp
  const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.05)
  lastFrameTime = timestamp

  const bufferLength = analyser.frequencyBinCount
  if (!freqDataArray || freqDataArray.length !== bufferLength) {
    freqDataArray = new Uint8Array(bufferLength)
  }

  if (isPlaying) {
    analyser.getByteFrequencyData(freqDataArray)
  } else {
    freqDataArray.fill(0)
  }
  const dataArray = freqDataArray

  // Smooth data
  if (!smoothData || smoothData.length !== bufferLength) {
    smoothData = new Float32Array(bufferLength)
  }
  for (let i = 0; i < Math.min(bufferLength, 64); i++) {
    const dataIdx = Math.floor((i * bufferLength) / Math.min(bufferLength, 64))
    const rawValue = dataArray[dataIdx] || 0
    const target = rawValue / 255
    smoothData[i] = smoothData[i] * 0.75 + target * 0.25
  }

  const w = canvas.width
  const h = canvas.height

  // Music energy
  const avgFreq = dataArray.reduce((a, b) => a + b, 0) / bufferLength
  const energy = avgFreq / 255
  let bassSum = 0
  for (let i = 0; i < 6; i++) bassSum += dataArray[i] || 0
  const bassRaw = bassSum / (6 * 255)
  bassThreshold = bassThreshold * 0.85 + bassRaw * 0.15
  const bassDelta = bassRaw - bassThreshold

  // Particles (for both modes)
  if (isPlaying) {
    spawnAccumulator += energy * dt * 18
    while (spawnAccumulator >= 1) {
      spawnAccumulator -= 1
      spawnParticle(w, h, energy, 0)
    }
    if (bassRaw > 0.25 && bassDelta > 0.08) {
      const burstIntensity = Math.min(1, bassDelta * 4)
      for (let b = 0; b < 3; b++) {
        const bx = w * (0.2 + Math.random() * 0.6)
        spawnBurst(bx, h - 10, burstIntensity, w, h)
      }
    }
  }
  updateParticles(dt)

  ctx.clearRect(0, 0, w, h)

  // Background glow
  const glowIntensity = energy
  if (glowIntensity > 0.05) {
    const gradient = ctx.createRadialGradient(w / 2, h, 0, w / 2, h, h * 0.8)
    gradient.addColorStop(
      0,
      `rgba(${themeColors.c2.r}, ${themeColors.c2.g}, ${themeColors.c2.b}, ${glowIntensity * 0.15})`,
    )
    gradient.addColorStop(
      0.5,
      `rgba(${themeColors.c1.r}, ${themeColors.c1.g}, ${themeColors.c1.b}, ${glowIntensity * 0.08})`,
    )
    gradient.addColorStop(1, 'transparent')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
  }

  drawParticles(ctx, w, h)

  // Choose visualizer mode
  if (visualizerMode === 'radial') {
    drawRadialVisualizer(ctx, w, h, dataArray, bassRaw, energy, isPlaying, dt)
  } else {
    drawBarsVisualizer(ctx, w, h, dataArray, bassRaw, isPlaying)
  }
}

// ========== BAR VISUALIZER ==========
function drawBarsVisualizer(ctx, w, h, dataArray, bassRaw, isPlaying) {
  const bufferLength = analyser.frequencyBinCount
  const barCount = Math.min(bufferLength, 64)
  const barWidth = (w / barCount) * 0.85
  const gap = (w / barCount) * 0.15
  const maxHeight = h * 0.85
  const minBarHeight = 2

  for (let i = 0; i < barCount; i++) {
    const intensity = smoothData[i] || 0
    const barHeight = Math.max(intensity * maxHeight, minBarHeight)

    const x = i * (barWidth + gap) + gap / 2
    const normalizedPos = i / barCount

    const { r, g, b } = getBarColor(normalizedPos)
    const alpha = 0.4 + intensity * 0.6
    const barColor = `rgba(${r}, ${g}, ${b}, ${alpha})`

    if (intensity > 0.3) {
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${intensity * 0.4})`
      ctx.shadowBlur = 8 + intensity * 12
    } else {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }

    const barX = x
    const barY = h - barHeight
    const radius = Math.min(barWidth / 2, 4)

    ctx.beginPath()
    ctx.moveTo(barX + radius, barY)
    ctx.lineTo(barX + barWidth - radius, barY)
    ctx.quadraticCurveTo(barX + barWidth, barY, barX + barWidth, barY + radius)
    ctx.lineTo(barX + barWidth, h)
    ctx.lineTo(barX, h)
    ctx.lineTo(barX, barY + radius)
    ctx.quadraticCurveTo(barX, barY, barX + radius, barY)
    ctx.closePath()
    ctx.fillStyle = barColor
    ctx.fill()

    if (intensity > 0.2) {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.beginPath()
      ctx.moveTo(barX + radius, barY)
      ctx.lineTo(barX + barWidth - radius, barY)
      ctx.strokeStyle = `rgba(255, 255, 255, ${intensity * 0.3})`
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  // Bass pulse
  if (bassRaw > 0.05 && isPlaying) {
    const pulseRadius = 15 + bassRaw * 35
    const pulseAlpha = bassRaw * 0.3
    const pulseGrad = ctx.createRadialGradient(w / 2, h - 5, 0, w / 2, h - 5, pulseRadius)
    pulseGrad.addColorStop(0, `rgba(255, 255, 255, ${pulseAlpha})`)
    pulseGrad.addColorStop(
      0.4,
      `rgba(${themeColors.c1.r}, ${themeColors.c1.g}, ${themeColors.c1.b}, ${pulseAlpha * 0.6})`,
    )
    pulseGrad.addColorStop(1, 'transparent')
    ctx.beginPath()
    ctx.arc(w / 2, h - 5, pulseRadius, 0, Math.PI * 2)
    ctx.fillStyle = pulseGrad
    ctx.fill()
  }

  // Top waveform
  if (isPlaying && analyser) {
    const bufferLength = analyser.frequencyBinCount
    if (!waveformBuffer || waveformBuffer.length !== bufferLength) {
      waveformBuffer = new Uint8Array(bufferLength)
    }
    analyser.getByteTimeDomainData(waveformBuffer)
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 1.5
    const wfStep = Math.max(1, Math.floor(bufferLength / (w / 2)))
    for (let i = 0; i < w; i += 2) {
      const idx = Math.min(Math.floor((i / w) * bufferLength * wfStep), bufferLength - 1)
      const value = (waveformBuffer[idx] / 128) * (h * 0.15)
      const y = h - value
      if (i === 0) ctx.moveTo(i, y)
      else ctx.lineTo(i, y)
    }
    ctx.stroke()
  }
}

// ========== RADIAL VISUALIZER ==========
function drawRadialVisualizer(ctx, w, h, dataArray, bassRaw, energy, isPlaying, dt) {
  const cx = w / 2
  const cy = h / 2
  const maxRadius = Math.min(cx, cy) * 0.85
  const minRadius = maxRadius * 0.12
  const barCount = 48
  const barAngle = (Math.PI * 2) / barCount
  const barWidthRad = barAngle * 0.75

  // Rotation speed affected by energy
  rotationAngle += dt * (0.3 + energy * 0.6)

  // Center glow
  if (bassRaw > 0.05) {
    const centerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius * 0.4)
    const alpha = bassRaw * 0.2
    centerGlow.addColorStop(
      0,
      `rgba(${themeColors.c2.r}, ${themeColors.c2.g}, ${themeColors.c2.b}, ${alpha})`,
    )
    centerGlow.addColorStop(
      0.5,
      `rgba(${themeColors.c1.r}, ${themeColors.c1.g}, ${themeColors.c1.b}, ${alpha * 0.5})`,
    )
    centerGlow.addColorStop(1, 'transparent')
    ctx.fillStyle = centerGlow
    ctx.beginPath()
    ctx.arc(cx, cy, maxRadius * 0.4, 0, Math.PI * 2)
    ctx.fill()
  }

  // Draw circular bars
  for (let i = 0; i < barCount; i++) {
    const dataIdx = Math.floor((i * 64) / barCount)
    const intensity = smoothData[dataIdx] || 0

    const angle = i * barAngle + rotationAngle
    const barLen = minRadius + intensity * (maxRadius - minRadius)
    const innerR = minRadius - 2

    const { r, g, b } = getBarColor(i / barCount)
    const alpha = 0.35 + intensity * 0.65

    // Calculate the four corners of the bar
    const halfWidth = barWidthRad / 2
    const a1 = angle - halfWidth
    const a2 = angle + halfWidth

    const x1 = cx + Math.cos(a1) * innerR
    const y1 = cy + Math.sin(a1) * innerR
    const x2 = cx + Math.cos(a2) * innerR
    const y2 = cy + Math.sin(a2) * innerR
    const x3 = cx + Math.cos(a2) * barLen
    const y3 = cy + Math.sin(a2) * barLen
    const x4 = cx + Math.cos(a1) * barLen
    const y4 = cy + Math.sin(a1) * barLen

    // Glow for larger bars
    if (intensity > 0.3) {
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${intensity * 0.5})`
      ctx.shadowBlur = 6 + intensity * 10
    } else {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }

    // Draw trapezoid bar
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.lineTo(x3, y3)
    ctx.lineTo(x4, y4)
    ctx.closePath()
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
    ctx.fill()

    // Inner highlight
    if (intensity > 0.15) {
      const hx1 = cx + Math.cos(a1 + halfWidth * 0.3) * (innerR + 2)
      const hy1 = cy + Math.sin(a1 + halfWidth * 0.3) * (innerR + 2)
      const hx2 = cx + Math.cos(a2 - halfWidth * 0.3) * (innerR + 2)
      const hy2 = cy + Math.sin(a2 - halfWidth * 0.3) * (innerR + 2)
      const hx3 = cx + Math.cos(a2 - halfWidth * 0.3) * barLen
      const hy3 = cy + Math.sin(a2 - halfWidth * 0.3) * barLen
      const hx4 = cx + Math.cos(a1 + halfWidth * 0.3) * barLen
      const hy4 = cy + Math.sin(a1 + halfWidth * 0.3) * barLen

      ctx.beginPath()
      ctx.moveTo(hx1, hy1)
      ctx.lineTo(hx2, hy2)
      ctx.lineTo(hx3, hy3)
      ctx.lineTo(hx4, hy4)
      ctx.closePath()
      ctx.fillStyle = `rgba(255, 255, 255, ${intensity * 0.15})`
      ctx.fill()
    }
  }

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  // Center circle with bass pulse
  if (bassRaw > 0.05 && isPlaying) {
    const pulseR = minRadius * (0.3 + bassRaw * 0.5)
    const pulseGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR)
    const pulseAlpha = bassRaw * 0.4
    pulseGrad.addColorStop(0, `rgba(255, 255, 255, ${pulseAlpha})`)
    pulseGrad.addColorStop(
      0.5,
      `rgba(${themeColors.c1.r}, ${themeColors.c1.g}, ${themeColors.c1.b}, ${pulseAlpha * 0.5})`,
    )
    pulseGrad.addColorStop(1, 'transparent')
    ctx.beginPath()
    ctx.arc(cx, cy, pulseR, 0, Math.PI * 2)
    ctx.fillStyle = pulseGrad
    ctx.fill()
  }

  // Subtle outer ring
  ctx.beginPath()
  ctx.arc(cx, cy, maxRadius + 2, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
  ctx.lineWidth = 1
  ctx.stroke()
}

// ========== VISUALIZER MODE TOGGLE ==========
const vizModeBtn = document.getElementById('viz-mode-btn')
vizModeBtn.addEventListener('click', () => {
  visualizerMode = visualizerMode === 'bars' ? 'radial' : 'bars'
  vizModeBtn.classList.toggle('active', visualizerMode === 'radial')
  // Toggle SVG icons
  document.getElementById('viz-bar-icon').classList.toggle('hidden', visualizerMode === 'radial')
  document.getElementById('viz-circle-icon').classList.toggle('hidden', visualizerMode === 'bars')
  document.getElementById('viz-circle-dot').classList.toggle('hidden', visualizerMode === 'bars')
  vizModeBtn.title = visualizerMode === 'radial' ? 'Visualizer radial' : 'Visualizer barras'
  saveSettings()
})

// ========== IDLE VISUALIZER ==========
function drawIdleVisualizer() {
  if (!ctx || !canvas.width) return
  const w = canvas.width
  const h = canvas.height

  ctx.clearRect(0, 0, w, h)

  // Draw subtle animated bars for idle state
  const barCount = 32
  const barWidth = (w / barCount) * 0.7
  const gap = (w / barCount) * 0.3
  const maxHeight = h * 0.3
  const now = Date.now()

  for (let i = 0; i < barCount; i++) {
    const barHeight = 2 + Math.sin(now / 1000 + i * 0.5) * maxHeight * 0.3 + maxHeight * 0.2
    const x = i * (barWidth + gap) + gap / 2
    const y = h - barHeight
    const radius = Math.min(barWidth / 2, 3)

    const alpha = 0.08 + (Math.sin(now / 800 + i * 0.5) * 0.04 + 0.04)

    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + barWidth - radius, y)
    ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius)
    ctx.lineTo(x + barWidth, h)
    ctx.lineTo(x, h)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
    ctx.fill()
  }
}

// ========== IDLE LOOP MANAGEMENT ==========
function startIdleLoop() {
  if (idleRaf) return
  function loop() {
    idleRaf = requestAnimationFrame(loop)
    if (!rafId && canvas.width) {
      drawIdleVisualizer()
    }
  }
  loop()
}

function stopIdleLoop() {
  if (idleRaf) {
    cancelAnimationFrame(idleRaf)
    idleRaf = null
  }
}

// ========== RESIZE HANDLING ==========
window.addEventListener('resize', resizeCanvas)

// ========== GLOBAL DRAG/DROP PREVENTION ==========
// Prevent browser from navigating to dropped files outside the drop zone
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// ========== SETTINGS PERSISTENCE ==========
function saveSettings() {
  const settings = {
    theme: localStorage.getItem('audize-theme') || 'neon',
    volume: volumeBar.value,
    repeatMode: repeatMode,
    shuffleMode: shuffleMode,
    visualizerMode: visualizerMode,
    currentSort: currentSort,
    eq: {
      bass: document.getElementById('eq-bass').value,
      mid: document.getElementById('eq-mid').value,
      treble: document.getElementById('eq-treble').value,
    },
  }
  localStorage.setItem('audize-settings', JSON.stringify(settings))
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('audize-settings')
    if (!raw) return
    const s = JSON.parse(raw)

    // Volume
    if (s.volume != null) {
      volumeBar.value = s.volume
    }

    // Repeat mode
    if (s.repeatMode) {
      repeatMode = s.repeatMode
      updateRepeatUI()
    }

    // Shuffle mode
    if (s.shuffleMode) {
      shuffleMode = true
      document.getElementById('shuffle-btn').classList.add('active')
      document.getElementById('shuffle-btn').title = 'Aleatório: ativo'
    }

    // Visualizer mode
    if (s.visualizerMode) {
      visualizerMode = s.visualizerMode
      vizModeBtn.classList.toggle('active', visualizerMode === 'radial')
      document
        .getElementById('viz-bar-icon')
        .classList.toggle('hidden', visualizerMode === 'radial')
      document
        .getElementById('viz-circle-icon')
        .classList.toggle('hidden', visualizerMode === 'bars')
      document
        .getElementById('viz-circle-dot')
        .classList.toggle('hidden', visualizerMode === 'bars')
      vizModeBtn.title = visualizerMode === 'radial' ? 'Visualizer radial' : 'Visualizer barras'
    }

    // Theme (migrate from old audize-theme key if needed)
    if (s.theme) {
      applyTheme(s.theme)
    }

    // EQ
    if (s.eq) {
      if (s.eq.bass != null) document.getElementById('eq-bass').value = s.eq.bass
      if (s.eq.mid != null) document.getElementById('eq-mid').value = s.eq.mid
      if (s.eq.treble != null) document.getElementById('eq-treble').value = s.eq.treble
      ;['bass', 'mid', 'treble'].forEach((band) => {
        updateEQSlider('eq-' + band, 'eq-' + band + '-val', 'eq-' + band + '-fill')
      })
    }

    // Sort
    if (s.currentSort && s.currentSort !== 'original') {
      currentSort = s.currentSort
      if (sortLabel) sortLabel.textContent = sortLabels[currentSort] || 'Original'
      if (sortDropdown) {
        sortDropdown.querySelectorAll('.pl-sort-option').forEach((o) => {
          o.classList.toggle('active', o.dataset.sort === currentSort)
        })
      }
    }
  } catch (_) {}
}

// Load saved settings on startup
loadSettings()

// Auto-save on volume change
volumeBar.addEventListener('input', saveSettings)

// Save on visibility change (user leaving page)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveSettings()
})

// Save before page unload
window.addEventListener('beforeunload', saveSettings)

// ========== CONFIRM MODAL ==========
const confirmModal = document.getElementById('confirm-modal')
const confirmTitle = document.getElementById('confirm-title')
const confirmMessage = document.getElementById('confirm-message')
const confirmOk = document.getElementById('confirm-ok')
const confirmCancel = document.getElementById('confirm-cancel')
const confirmOverlay = document.getElementById('confirm-overlay')
let confirmResolve = null

function showConfirm(title, message, okText = 'Confirmar') {
  return new Promise((resolve) => {
    confirmResolve = resolve
    confirmTitle.textContent = title
    confirmMessage.textContent = message
    confirmOk.textContent = okText
    confirmModal.classList.remove('hidden')
  })
}

function closeConfirm(result) {
  confirmModal.classList.add('hidden')
  if (confirmResolve) {
    confirmResolve(result)
    confirmResolve = null
  }
}

confirmOk.addEventListener('click', () => closeConfirm(true))
confirmCancel.addEventListener('click', () => closeConfirm(false))
confirmOverlay.addEventListener('click', () => closeConfirm(false))

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !confirmModal.classList.contains('hidden')) {
    closeConfirm(false)
    e.stopPropagation()
  }
})

// ========== CLEAR PLAYLIST ==========
document.getElementById('clear-playlist-btn').addEventListener('click', async () => {
  const confirmed = await showConfirm(
    'Limpar playlist',
    'Todos os áudios salvos serão removidos. Essa ação não pode ser desfeita.',
    'Limpar',
  )
  if (!confirmed) return
  await dbClear()
  // Revoke all URLs
  playlist.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url)
  })
  playlist = []
  originalPlaylistOrder = null
  sortOriginalOrder = null
  currentSort = 'original'
  if (sortLabel) sortLabel.textContent = 'Original'
  if (sortDropdown) {
    sortDropdown.querySelectorAll('.pl-sort-option').forEach((o) => {
      o.classList.toggle('active', o.dataset.sort === 'original')
    })
  }
  if (isPlaying && audioEl) audioEl.pause()
  stopVisualizer()
  if (audioContext) {
    audioContext.close().catch(() => {})
    audioContext = null
    source = null
    analyser = null
  }
  cleanupEQ()
  isPlaying = false
  currentIndex = -1
  playBtn.classList.remove('playing')
  coverContainer.classList.remove('playing')
  updatePlayIcon(false)
  playerScreen.classList.add('hidden')
  uploadScreen.classList.remove('hidden')
  startIdleLoop()
  updateStorageInfo()
})

// ========== INIT ==========
const loadingScreen = document.getElementById('loading-screen')

createParticles()
resizeCanvas()
startIdleLoop()

// Initialize range fills
updateRangeFill(seekBar)
updateRangeFill(volumeBar)

// Initialize IndexedDB and try to restore playlist
;(async () => {
  try {
    await openDB()
    const restored = await loadPlaylistFromDB()
    if (restored && playlist.length > 0) {
      // Playlist restored — show player
      loadingScreen.classList.add('hidden')
      playerScreen.classList.remove('hidden')
      resizeCanvas()
      // Apply saved sort
      if (currentSort && currentSort !== 'original') {
        sortOriginalOrder = null
        sortPlaylist(currentSort)
      } else {
        renderPlaylist()
      }
      extractAllTags()
      // Load first track without auto-playing
      playTrack(0, false)
      // Restore shuffle order if shuffle was active
      if (shuffleMode) {
        generateShuffleOrder()
      }
    } else {
      // No saved playlist — show upload screen
      loadingScreen.classList.add('hidden')
      uploadScreen.classList.remove('hidden')
    }
  } catch (e) {
    console.warn('Could not restore playlist:', e)
    loadingScreen.classList.add('hidden')
    uploadScreen.classList.remove('hidden')
  }
})()

// Log a tip
