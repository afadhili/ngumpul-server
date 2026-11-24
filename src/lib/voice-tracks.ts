import { TrackSource, TrackType } from "livekit-server-sdk";

/**
 * Minimal shape of a LiveKit track as returned by RoomServiceClient. The
 * numeric enums are used instead of strings because that is what the protobuf
 * responses carry.
 */
export type VoiceTrackLike = {
    type: number;
    source?: number;
    muted: boolean;
};

export type VoiceTrackState = {
    isPublisher: boolean;
    audioMuted: boolean;
    videoEnabled: boolean;
    screenShareEnabled: boolean;
};

type TrackKind = "data" | "microphone" | "camera" | "screen-share";

function classifyTrack(track: VoiceTrackLike): TrackKind {
    if (track.type === TrackType.DATA) return "data";
    if (track.source === TrackSource.SCREEN_SHARE || track.source === TrackSource.SCREEN_SHARE_AUDIO) return "screen-share";
    if (track.source === TrackSource.MICROPHONE) return "microphone";
    if (track.source === TrackSource.CAMERA) return "camera";
    // Older clients may publish tracks without an explicit source; fall back to
    // the media type.
    return track.type === TrackType.AUDIO ? "microphone" : "camera";
}

/**
 * Derives the media state shown in the voice channel member list.
 *
 * `audioMuted` is true when the participant has no microphone track or muted it,
 * `videoEnabled` is true only for an unmuted camera track, and
 * `screenShareEnabled` is true only for an unmuted screen-share video track.
 * A muted track stays published in LiveKit, so `muted` must be inspected.
 */
export function summarizeVoiceTracks(tracks: ReadonlyArray<VoiceTrackLike>): VoiceTrackState {
    const kinds = tracks.map(track => ({ track, kind: classifyTrack(track) }));
    const microphone = kinds.find(entry => entry.kind === "microphone")?.track;
    const camera = kinds.find(entry => entry.kind === "camera")?.track;
    const screenShare = kinds.find(entry => entry.kind === "screen-share" && entry.track.type === TrackType.VIDEO)?.track;
    const media = kinds.filter(entry => entry.kind !== "data");

    return {
        isPublisher: media.length > 0,
        audioMuted: !microphone || microphone.muted,
        videoEnabled: Boolean(camera && !camera.muted),
        screenShareEnabled: Boolean(screenShare && !screenShare.muted),
    };
}
