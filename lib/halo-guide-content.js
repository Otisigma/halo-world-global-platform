export const GUIDE_ROUTES = [
  "/", "/halo-live.html", "/dj-deck.html", "/vip_launchpad.html", "/creators/", "/#clubhouse",
  "/obsidian/", "/music/", "/song-catalog/", "/radio/", "/support/"
];

export const GUIDE_PAGES = {
  "/obsidian": {
    title: "Explore the Obsidian Gateway",
    overview: "Select a public release, then press play. Filters change the grid without stopping the current release. Personal playlists are stored in this browser only, not uploaded or synced.",
    controls: {
      "#tracks": ["HALO Sound Vaults", "Select a release here, then press play in the audio player."],
      "#audio": ["Listen", "Use the native audio controls to play, pause, seek, or change volume. Some releases have catalog links only."],
      "#createPlaylistForm": ["Create a playlist", "Enter a name and choose Create playlist. Your playlists are saved only in this browser."],
      "#addToPlaylist": ["Choose a playlist", "Choose one of your saved playlists for the currently selected public release."],
      "#addToPlaylistButton": ["Add release", "Adds the selected public catalog release to your chosen playlist. A release cannot be added twice."],
      "#userPlaylists": ["Queue your mix", "Queue mix selects the first release with in-page audio. Press play to start. Remove and Delete playlist change your saved playlist."],
      "#continueNext": ["Continue listening", "When enabled, the next playable release starts after the current one ends. An active personal playlist keeps continuation inside that playlist."],
      "#loop": ["Loop this release", "Repeats the selected audio file. Loop takes priority over continuation."],
      "#shareMoment": ["Share a moment", "Copies a release link with the current playback time. This shares a release, not your personal playlist."],
      "#genreFilterSummary": ["Browse genres", "Opens the genre filters. Counts represent public releases, not audio files."]
    }
  },
  "/music": {
    title: "Find music in the HALO catalog",
    overview: "Browse public releases by title, artist, genre, or collection. Choose a release's listening or artist-approved destination. Buying and licensing are separate actions.",
    controls: {
      "#catalogSearch": ["Search releases", "Filters the catalog by title, artist, collection, or genre."],
      "#catalogSort": ["Sort releases", "Changes the catalog display order using the selected option."],
      "#catalogGenreSummary": ["Browse genres", "Opens the genre filters. Choose All releases to clear the genre selection."],
      "#releaseGrid": ["Explore releases", "Choose a release's own listening or approved destination. An external destination may open another site."],
      "#listeningAnalytics": ["Optional listening reports", "Controls optional listening reports. Check the adjacent status for your saved choice."],
      "#streamAlertSharing": ["Optional stream alerts", "Controls anonymous stream-completion alerts shared with HALO operations."]
    }
  },
  "/song-catalog": {
    title: "Manage your music",
    overview: "Sign in to manage your own songs. Add a finished recording as its sale master; stems and instrumentals are optional. Uploading is not publication or proof of ownership.",
    controls: {
      "#catalogSignInButton": ["Sign in", "Starts sign-in for your private song catalog. Never send your password to the guide."],
      "#addSongButton": ["Add a song", "Starts a new song record. Follow the song form and its upload requirements."],
      "#importButton": ["Load existing songs", "Loads existing songs using the catalog import workflow. Review its confirmation and status."],
      "#searchInput": ["Find your song", "Searches your song catalog by title or artist."]
    }
  },
  "/radio": {
    title: "Listen to HALO Radio",
    overview: "Choose a station and press its play control yourself. Listening and creator submissions are separate workflows.",
    controls: {}
  },
  "/dreamweaver": {
    title: "Experience a release",
    overview: "Choose a song and press Play. Audio errors are not proof of an offline connection. A local preview is not an upload or publication.",
    controls: {
      "#showAudio": ["Release audio", "This audio element reports the browser's observed playback state. The guide does not start or repair playback."],
      "#aiReadiness": ["Readiness telemetry", "Playing indicates a media playback event. Buffering or stream fault describes an observed player state, not a guarantee of audible sound."]
    }
  }
};

export function pageHelp(pathname) {
  const path = String(pathname || "/").split(/[?#]/)[0].replace(/\/index\.html$/, "/").replace(/\/+$/, "") || "/";
  return GUIDE_PAGES[path] || {
    title: "Explore this HALO page",
    overview: "Browse the visible controls below. Authored guidance explains supported actions; where detailed help is missing, the guide describes only the control type. It never clicks, submits, purchases, or publishes for you.",
    controls: {}
  };
}
