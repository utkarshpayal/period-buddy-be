/* global config -- defined by the Jitsi web page this file is appended to. */
// Nura overrides, appended to the generated config.js by the web container
// (installed to ${CONFIG}/web/custom-config.js by install.sh). Client-side
// UI defaults only: security is enforced by prosody (JWT, room claim,
// token_affiliation), not here. Never put secrets in this file.

// No way to bring anyone else in, and no host extras.
config.disableInviteFunctions = true;
config.hideConferenceSubject = true;
config.enableInsecureRoomNameWarning = false;
config.prejoinConfig = { enabled: false };
config.securityUi = { hideLobbyButton: true, disableLobbyPassword: true };
config.remoteVideoMenu = { disableGrantModerator: true, disablePrivateChat: true };
config.breakoutRooms = {
  hideAddRoomButton: true,
  hideAutoAssignButton: true,
  hideJoinRoomButton: true,
};

// Off: recording, streaming, transcription, file sharing, whiteboard, GIFs.
config.recordingService = { enabled: false, sharingEnabled: false };
config.liveStreaming = { enabled: false };
config.localRecording = { disable: true };
config.transcription = { enabled: false };
config.fileSharing = { enabled: false };
config.whiteboard = { enabled: false };
config.giphy = { enabled: false };

// No third-party calls from the meeting page (avatars, analytics).
config.disableThirdPartyRequests = true;
config.gravatar = { disabled: true };
config.analytics = { disabled: true };

// Mobile: the app embeds this page; never send people to the Jitsi app.
config.disableDeepLinking = true;
