(() => {
  const groups = [
    {
      id: 'listen', title: 'Listen & discover', description: 'Records, mixes, radio, and the stories around them.',
      entries: [
        { href: '/music-world.html', title: 'Music World', description: 'Explore the music shop and release pipeline.' },
        { href: '/music/', title: 'Music catalog', description: 'Listen, buy, and share the permanent catalog.' },
        { href: '/dreamweaver/', title: 'Dreamweaver', description: 'Enter the song lobby and fan experience.' },
        { href: '/mixes/', title: 'HALO X Mixes', description: 'Watch and stream mix editions.' },
        { href: '/radio/', title: 'HALO Radio', description: 'Tune into the creator-owned broadcast.' },
        { href: '/halo-x.html', title: 'DJ HALO X', description: 'Explore the artist universe and founders room.' },
        { href: '/magazine.html', title: 'HALO Signal magazine', description: 'Read music, nightlife, and creator intelligence.' },
        { href: '/when-the-world-goes-dark/', title: 'When The World Goes Dark', description: 'Open Owen Anthony’s featured release world.' }
      ]
    },
    {
      id: 'release', title: 'Create & release', description: 'From the first idea to artwork, masters, and delivery.',
      entries: [
        { href: '/dreamweaver-lab/', title: 'Dreamweaver Song Lab', description: 'Develop songs in the creative workspace.' },
        { href: '/upload-pipeline/', title: 'Upload Pipeline', description: 'Prepare and follow music uploads.' },
        { href: '/music-upload/', title: 'Music Upload & Shop', description: 'Open the upload and direct-purchase workspace.' },
        { href: '/song-catalog/', title: 'Song Catalog', description: 'Manage songs, masters, and publication readiness.' },
        { href: '/finish-house/', title: 'Finish House', description: 'Take a mix through mastering and release preparation.' },
        { href: '/release-house/', title: 'Release House', description: 'Finish and release your first song.' },
        { href: '/release-kit.html', title: 'Release Kit', description: 'Prepare the materials around a release.' },
        { href: '/artwork-manager.html', title: 'Artwork Manager', description: 'Work with release covers and visual assets.' },
        { href: '/halo_agent_console_single_cover_lab.html', title: 'Agent Console & Media Lab', description: 'Open the single-cover and media workspace.' }
      ]
    },
    {
      id: 'broadcast', title: 'Perform & broadcast', description: 'Live rooms, DJ tools, video, and the signal network.',
      entries: [
        { href: '/dj-deck.html', title: 'Live DJ Deck', description: 'Open the live performance command deck.' },
        { href: '/halo-live.html', title: 'HALO Live', description: 'Run the global broadcast command center.' },
        { href: '/live-party/', title: 'Live Party Hub', description: 'Connect the music to a live party.' },
        { href: '/youtube-studio/', title: 'YouTube Source Box', description: 'Manage video sources for the platform.' },
        { href: '/signal-network/', title: 'Signal Network', description: 'Explore the connected broadcast network.' },
        { href: '/halo_signal_network_console.html', title: 'Signal Network Console', description: 'Open the network operations console.' }
      ]
    },
    {
      id: 'business', title: 'Artist business', description: 'Release services, licensing, distribution, and income.',
      entries: [
        { href: '/artist-pro/', title: 'Artist Pro', description: 'Open the professional release command system.' },
        { href: '/artist/dashboard', title: 'Business Hub', description: 'Manage income, reserves, and obligations.' },
        { href: '/artist-economy/', title: 'Artist Economy', description: 'Build a living around your work.' },
        { href: '/artists/', title: 'Artist Rooms & Charts', description: 'Explore artist rooms and featured drops.' },
        { href: '/album-concierge/', title: 'Album Concierge', description: 'Plan the work around an album.' },
        { href: '/toolost/', title: 'HALO Distribution', description: 'Open the Toolost distribution workspace.' },
        { href: '/sync-hub/', title: 'Sync Licensing', description: 'Explore tracks, stems, and licensing inquiries.' },
        { href: '/asset-inventory/', title: 'Asset Inventory', description: 'Review built assets, valuations, and pricing.' }
      ]
    },
    {
      id: 'community', title: 'People & campaigns', description: 'Creator connections, promotion, and shared opportunities.',
      entries: [
        { href: '/creators/', title: 'Creator World', description: 'Explore creator tools, services, and pathways.' },
        { href: '/creator-network/', title: 'Creator Network', description: 'Find member profiles and opportunities.' },
        { href: '/creator-freedom/', title: 'Creator Freedom', description: 'Read the charter and visit the public room.' },
        { href: '/ambassadors/', title: 'Sovereign Ambassadors', description: 'Explore the community contribution pathway.' },
        { href: '/campaign-studio/', title: 'Campaign Studio', description: 'Build the campaign around your music.' },
        { href: '/iam-social/', title: 'I AM Social', description: 'Open the social publishing workspace.' },
        { href: '/halo-relations.html', title: 'HALO Relations', description: 'Open the human connection desk.' },
        { href: '/outreach.html', title: 'Outreach Desk', description: 'Get the record to the right people.' },
        { href: '/partner-trust.html', title: 'Partner Trust', description: 'Review partner relationships and trust.' },
        { href: '/creators/gear-guide.html', title: 'Signal Chain Gear Guide', description: 'Explore recording gear and release guidance.' }
      ]
    },
    {
      id: 'operations', title: 'Operations & reports', description: 'Platform tools, evidence, support, and private workspaces.',
      entries: [
        { href: '/halo-command.html', title: 'HALO Control Center', description: 'Open private AI operations and maintenance.' },
        { href: '/artist-team.html', title: 'Artist Agent Team', description: 'Coordinate management, content, and fan growth.' },
        { href: '/halo-ledger/', title: 'Halo Ledger', description: 'Review the platform’s operational memory.' },
        { href: '/asset-editor/', title: 'Sitewide Asset Editor', description: 'Edit platform visual assets.' },
        { href: '/stats/', title: 'Public Stats', description: 'Review published catalog and destination signals.' },
        { href: '/support/', title: 'Feedback Desk', description: 'Send feedback and find support.' },
        { href: '/reports/own-the-return/', title: 'Own the Return', description: 'Read the HALO Signal white paper.' },
        { href: '/vip_launchpad.html', title: 'VIP Beta Launchpad', description: 'Open the beta platform launchpad.' }
      ]
    }
  ];

  const filter = (query = '', category = 'all') => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return groups.filter(group => category === 'all' || group.id === category).map(group => ({
      ...group,
      entries: group.entries.filter(entry => {
        const text = `${group.title} ${entry.title} ${entry.description}`.toLowerCase();
        return terms.every(term => text.includes(term));
      })
    })).filter(group => group.entries.length);
  };

  window.HALOFeatureDirectory = { groups, filter, count: groups.reduce((total, group) => total + group.entries.length, 0) };
})();
