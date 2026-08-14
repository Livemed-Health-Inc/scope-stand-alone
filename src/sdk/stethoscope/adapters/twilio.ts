/**
 * Twilio Video adapter — publishes the processed stethoscope audio into a
 * Twilio Video Room as its own named track.
 *
 *   import Video from "twilio-video";
 *   import { publishStethoscope } from "@virtualis/stethoscope-sdk/adapters/twilio";
 *
 *   const handle = await publishStethoscope({ room, Video, client: scope });
 *   // ...later
 *   handle.unpublish();
 *
 * The SDK stays dependency-free: `twilio-video` is passed in by the host app
 * and only structurally typed here.
 */
import type { StethoscopeClient } from "../core/client";

/** Minimal shape of the `twilio-video` module we rely on. */
export interface TwilioVideoLib {
  LocalAudioTrack: new (
    track: MediaStreamTrack,
    options?: { name?: string; logLevel?: string },
  ) => TwilioLocalAudioTrack;
}

export interface TwilioLocalAudioTrack {
  name: string;
  stop: () => void;
}

/** Minimal shape of a connected Twilio `Room`. */
export interface TwilioRoomLike {
  localParticipant: {
    publishTrack: (track: TwilioLocalAudioTrack, options?: unknown) => Promise<unknown>;
    unpublishTrack: (track: TwilioLocalAudioTrack) => unknown;
  };
}

export interface PublishStethoscopeOptions {
  /** A connected Twilio Video Room. */
  room: TwilioRoomLike;
  /** The `twilio-video` module (or anything with `LocalAudioTrack`). */
  Video: TwilioVideoLib;
  /** A stethoscope client that is already capturing (or about to). */
  client: StethoscopeClient;
  /** Track name remote participants see. Default `"stethoscope"`. */
  name?: string;
  /**
   * Start capture if the device is connected but idle. Default `true`.
   */
  autoStartCapture?: boolean;
  /** Track publish priority. Default `"high"` so audio isn't degraded. */
  priority?: "low" | "standard" | "high";
}

export interface StethoscopePublication {
  track: TwilioLocalAudioTrack;
  mediaStreamTrack: MediaStreamTrack;
  /** Unpublish + stop the stethoscope track (leaves the mic untouched). */
  unpublish: () => void;
}

/**
 * Publishes `client.callStream`'s audio as a dedicated Twilio track.
 *
 * The track is hinted as `"music"` so Twilio's voice processing doesn't
 * high-pass away the 20–220 Hz heart-sound band.
 */
export async function publishStethoscope({
  room,
  Video,
  client,
  name = "stethoscope",
  autoStartCapture = true,
  priority = "high",
}: PublishStethoscopeOptions): Promise<StethoscopePublication> {
  if (autoStartCapture && !client.getState().capturing) {
    await client.startCapture();
  }

  const stream = client.getState().callStream;
  const mediaStreamTrack = stream?.getAudioTracks()[0];
  if (!mediaStreamTrack) {
    throw new Error(
      "No stethoscope audio track yet — connect the device and startCapture() first.",
    );
  }

  // Keep the low end intact end-to-end.
  mediaStreamTrack.contentHint = "music";

  const track = new Video.LocalAudioTrack(mediaStreamTrack, { name });
  await room.localParticipant.publishTrack(track, { priority });

  let live = true;
  return {
    track,
    mediaStreamTrack,
    unpublish: () => {
      if (!live) return;
      live = false;
      try {
        room.localParticipant.unpublishTrack(track);
      } finally {
        track.stop();
      }
    },
  };
}

/**
 * Convenience: publish while capturing and unpublish automatically when the
 * clinician stops the auscultation. Returns an unsubscribe function.
 */
export function bindStethoscopeToRoom(
  options: Omit<PublishStethoscopeOptions, "autoStartCapture">,
): () => void {
  const { client } = options;
  let pub: StethoscopePublication | null = null;
  let pending = false;

  const sync = async (capturing: boolean) => {
    if (capturing && !pub && !pending) {
      pending = true;
      try {
        pub = await publishStethoscope({ ...options, autoStartCapture: false });
      } finally {
        pending = false;
      }
    } else if (!capturing && pub) {
      pub.unpublish();
      pub = null;
    }
  };

  const unsubscribe = client.subscribe((s) => void sync(s.capturing));
  void sync(client.getState().capturing);

  return () => {
    unsubscribe();
    pub?.unpublish();
    pub = null;
  };
}