import BasePlaylistController from './base-playlist-controller';
import { ErrorDetails, ErrorTypes } from '../errors';
import { Events } from '../events';
import { LoaderContextType } from '../types/loader';
import { mediaAttributesIdentical } from '../utils/media-option-attributes';
import {
  audioMatchPredicate,
  findClosestLevelWithAudioGroup,
  findMatchingOption,
  inGroupOrNone,
  matchesOption,
  useAlternateAudio,
} from '../utils/rendition-helper';
import type Hls from '../hls';
import type {
  AudioTrackLoadedData,
  AudioTracksUpdatedData,
  ErrorData,
  LevelLoadingData,
  LevelSwitchingData,
  ManifestParsedData,
} from '../types/events';
import type { HlsUrlParameters } from '../types/level';
import type {
  AudioSelectionOption,
  MediaPlaylist,
} from '../types/media-playlist';

class AudioTrackController extends BasePlaylistController {
  private tracks: MediaPlaylist[] = [];
  private groupIds: (string | undefined)[] | null = null;
  private tracksInGroup: MediaPlaylist[] = [];
  private trackId: number = -1;
  private currentTrack: MediaPlaylist | null = null;
  private selectDefaultTrack: boolean = true;

  constructor(hls: Hls) {
    super(hls, 'audio-track-controller');
    this.registerListeners();
  }

  private registerListeners() {
    const { hls } = this;
    hls.on(Events.MANIFEST_LOADING, this.onManifestLoading, this);
    hls.on(Events.MANIFEST_PARSED, this.onManifestParsed, this);
    hls.on(Events.LEVEL_LOADING, this.onLevelLoading, this);
    hls.on(Events.LEVEL_SWITCHING, this.onLevelSwitching, this);
    hls.on(Events.AUDIO_TRACK_LOADED, this.onAudioTrackLoaded, this);
    hls.on(Events.ERROR, this.onError, this);
  }

  private unregisterListeners() {
    const { hls } = this;
    hls.off(Events.MANIFEST_LOADING, this.onManifestLoading, this);
    hls.off(Events.MANIFEST_PARSED, this.onManifestParsed, this);
    hls.off(Events.LEVEL_LOADING, this.onLevelLoading, this);
    hls.off(Events.LEVEL_SWITCHING, this.onLevelSwitching, this);
    hls.off(Events.AUDIO_TRACK_LOADED, this.onAudioTrackLoaded, this);
    hls.off(Events.ERROR, this.onError, this);
  }

  public destroy() {
    this.unregisterListeners();
    this.tracks.length = 0;
    this.tracksInGroup.length = 0;
    this.currentTrack = null;
    super.destroy();
  }

  protected onManifestLoading(): void {
    this.tracks = [];
    this.tracksInGroup = [];
    this.groupIds = null;
    this.currentTrack = null;
    this.trackId = -1;
    this.selectDefaultTrack = true;
  }

  protected onManifestParsed(
    event: Events.MANIFEST_PARSED,
    data: ManifestParsedData,
  ): void {
    this.tracks = data.audioTracks || [];
  }

  protected onAudioTrackLoaded(
    event: Events.AUDIO_TRACK_LOADED,
    data: AudioTrackLoadedData,
  ): void {
    const { id, groupId, details } = data;
    const trackInActiveGroup = this.tracksInGroup[id];

    if (
      !trackInActiveGroup ||
      trackInActiveGroup.groupId !== (groupId as string | undefined)
    ) {
      this.warn(
        `Audio track with id:${id} and group:${groupId} not found in active group ${trackInActiveGroup?.groupId}`,
      );
      return;
    }

    const curDetails = trackInActiveGroup.details;
    trackInActiveGroup.details = data.details;
    this.log(
      `Audio track ${id} "${trackInActiveGroup.name}" lang:${trackInActiveGroup.lang} group:${groupId} loaded [${details.startSN}-${details.endSN}]`,
    );

    if (id === this.trackId) {
      this.playlistLoaded(id, data, curDetails);
    }
  }

  protected onLevelLoading(
    event: Events.LEVEL_LOADING,
    data: LevelLoadingData,
  ): void {
    this.switchLevel(data.level);
  }

  protected onLevelSwitching(
    event: Events.LEVEL_SWITCHING,
    data: LevelSwitchingData,
  ): void {
    this.switchLevel(data.level);
  }

  private switchLevel(levelIndex: number) {
    const levelInfo = this.hls.levels[levelIndex];
    if (!levelInfo) {
      return;
    }
    const audioGroups = levelInfo.audioGroups || null;
    const currentGroups = this.groupIds;
    // Keep a reference to the selected track so that an explicit user
    // selection (or the default track) can be carried over to an
    // equivalent rendition when the manifest refresh changes group-IDs.
    const previousTrack = this.currentTrack;
    let currentTrack = previousTrack;
    if (
      !audioGroups ||
      currentGroups?.length !== audioGroups?.length ||
      audioGroups?.some((groupId) => currentGroups?.indexOf(groupId) === -1)
    ) {
      this.groupIds = audioGroups;
      this.trackId = -1;
      this.currentTrack = null;

      const audioTracks = this.tracks.filter((track): boolean =>
        inGroupOrNone(track.groupId, audioGroups),
      );
      if (audioTracks.length) {
        // Disable selectDefaultTrack if there are no default tracks
        if (
          this.selectDefaultTrack &&
          !audioTracks.some((track) => track.default)
        ) {
          this.selectDefaultTrack = false;
        }
        // track.id should match hls.audioTracks index
        audioTracks.forEach((track, i) => {
          track.id = i;
        });
      } else if (!previousTrack && !this.tracksInGroup.length) {
        // Do not dispatch AUDIO_TRACKS_UPDATED when there were and are no tracks
        return;
      }
      this.tracksInGroup = audioTracks;

      // Find preferred track
      const audioPreference = this.hls.config.audioPreference;
      if (!currentTrack && audioPreference) {
        const groupIndex = findMatchingOption(
          audioPreference,
          audioTracks,
          audioMatchPredicate,
        );
        if (groupIndex > -1) {
          currentTrack = audioTracks[groupIndex];
        } else {
          const allIndex = findMatchingOption(audioPreference, this.tracks);
          currentTrack = this.tracks[allIndex];
        }
      }

      // Select initial track
      let trackId = this.findTrackId(currentTrack);
      if (trackId === -1 && currentTrack) {
        // No equivalent of the previously selected (or preferred) track
        // exists in the new group(s). Fall back to the new default track and
        // notify consumers of this single effective change.
        currentTrack = null;
        if (audioTracks.some((track) => track.default)) {
          this.selectDefaultTrack = true;
        }
        trackId = this.findTrackId(null);
      }

      // Dispatch events and load track if needed
      const audioTracksUpdated: AudioTracksUpdatedData = { audioTracks };
      this.log(
        `Updating audio tracks, ${
          audioTracks.length
        } track(s) found in group(s): ${audioGroups?.join(',')}`,
      );
      this.hls.trigger(Events.AUDIO_TRACKS_UPDATED, audioTracksUpdated);

      const selectedTrackId = this.trackId;
      if (trackId !== -1 && selectedTrackId === -1) {
        this.setAudioTrack(trackId);
      } else if (audioTracks.length && selectedTrackId === -1) {
        const error = new Error(
          `No audio track selected for current audio group-ID(s): ${this.groupIds?.join(
            ',',
          )} track count: ${audioTracks.length}`,
        );
        this.warn(error.message);

        this.hls.trigger(Events.ERROR, {
          type: ErrorTypes.MEDIA_ERROR,
          details: ErrorDetails.AUDIO_TRACK_LOAD_ERROR,
          fatal: true,
          error,
        });
      }
    }
  }

  protected onError(event: Events.ERROR, data: ErrorData): void {
    if (data.fatal || !data.context) {
      return;
    }

    if (
      data.context.type === LoaderContextType.AUDIO_TRACK &&
      data.context.id === this.trackId &&
      inGroupOrNone(data.context.groupId, this.groupIds)
    ) {
      this.checkRetry(data);
    }
  }

  get allAudioTracks(): MediaPlaylist[] {
    return this.tracks;
  }

  get audioTracks(): MediaPlaylist[] {
    return this.tracksInGroup;
  }

  get audioTrack(): number {
    return this.trackId;
  }

  set audioTrack(newId: number) {
    // If audio track is selected from API then don't choose from the manifest default track
    this.selectDefaultTrack = false;
    this.setAudioTrack(newId);
  }

  get nextAudioTrack(): number {
    return this.trackId;
  }

  set nextAudioTrack(newId: number) {
    // If audio track is selected from API then don't choose from the manifest default track
    this.selectDefaultTrack = false;
    this.setAudioTrack(newId, false);
  }

  public setAudioOption(
    audioOption: MediaPlaylist | AudioSelectionOption | undefined,
  ): MediaPlaylist | null {
    const hls = this.hls;
    hls.config.audioPreference = audioOption;
    if (audioOption) {
      const allAudioTracks = this.allAudioTracks;
      this.selectDefaultTrack = false;
      if (allAudioTracks.length) {
        // First see if current option matches (no switch op)
        const currentTrack = this.currentTrack;
        if (
          currentTrack &&
          matchesOption(audioOption, currentTrack, audioMatchPredicate)
        ) {
          return currentTrack;
        }
        // Find option in available tracks (tracksInGroup)
        const groupIndex = findMatchingOption(
          audioOption,
          this.tracksInGroup,
          audioMatchPredicate,
        );
        if (groupIndex > -1) {
          const track = this.tracksInGroup[groupIndex];
          this.setAudioTrack(
            groupIndex,
            'flushImmediate' in audioOption && audioOption.flushImmediate,
          );
          return track;
        } else if (currentTrack) {
          // Find option in nearest level audio group
          let searchIndex = hls.loadLevel;
          if (searchIndex === -1) {
            searchIndex = hls.firstAutoLevel;
          }
          const switchIndex = findClosestLevelWithAudioGroup(
            audioOption,
            hls.levels,
            allAudioTracks,
            searchIndex,
            audioMatchPredicate,
          );
          if (switchIndex === -1) {
            // could not find matching variant
            return null;
          }
          // and switch level to acheive the audio group switch
          hls.nextLoadLevel = switchIndex;
        }
        if (audioOption.channels || audioOption.audioCodec) {
          // Could not find a match with codec / channels predicate
          // Find a match without channels or codec
          const withoutCodecAndChannelsMatch = findMatchingOption(
            audioOption,
            allAudioTracks,
          );
          if (withoutCodecAndChannelsMatch > -1) {
            return allAudioTracks[withoutCodecAndChannelsMatch];
          }
        }
      }
    }
    return null;
  }

  private setAudioTrack(newId: number, flushImmediate: boolean = true): void {
    const tracks = this.tracksInGroup;

    // check if level idx is valid
    if (newId < 0 || newId >= tracks.length) {
      this.warn(`Invalid audio track id: ${newId}`);
      return;
    }

    this.selectDefaultTrack = false;
    const lastTrack = this.currentTrack;
    const track = tracks[newId];
    const trackLoaded = track.details && !track.details.live;
    if (newId === this.trackId && track === lastTrack && trackLoaded) {
      return;
    }
    this.log(
      `Switching to audio-track ${newId} "${track.name}" lang:${track.lang} group:${track.groupId} channels:${track.channels}`,
    );
    this.trackId = newId;
    this.currentTrack = track;
    this.hls.trigger(Events.AUDIO_TRACK_SWITCHING, {
      ...track,
      flushImmediate,
    });
    // Do not reload track unless live
    if (trackLoaded) {
      return;
    }
    const hlsUrlParameters = this.switchParams(
      track.url,
      lastTrack?.details,
      track.details,
    );
    this.loadPlaylist(hlsUrlParameters);
  }

  private findTrackId(currentTrack: MediaPlaylist | null): number {
    const audioTracks = this.tracksInGroup;
    for (let i = 0; i < audioTracks.length; i++) {
      const track = audioTracks[i];
      if (this.selectDefaultTrack && !track.default) {
        continue;
      }
      if (
        !currentTrack ||
        matchesOption(currentTrack, track, audioMatchPredicate)
      ) {
        return i;
      }
    }
    if (currentTrack) {
      // The group-ID is expected to change on a manifest refresh. Find the
      // equivalent rendition in the new group by its identity (name and
      // language) rather than its group, so an explicit user selection or the
      // default track is carried over instead of resetting to a different
      // (e.g. default English) rendition.
      const { name, lang, assocLang, characteristics, audioCodec, channels } =
        currentTrack;
      // 1. Same name, language and audio characteristics (new group allowed).
      //    This matches the parsed MediaPlaylist fields, so it works even when
      //    the raw attributes do not carry LANGUAGE / NAME.
      const equivalentOption = {
        name,
        lang,
        assocLang,
        characteristics,
        audioCodec,
        channels,
      };
      for (let i = 0; i < audioTracks.length; i++) {
        const track = audioTracks[i];
        if (matchesOption(equivalentOption, track, audioMatchPredicate)) {
          return i;
        }
      }
      // 2. Same language but a renamed rendition (e.g. "zh-main" ->
      //    "zh-main-v2"): the NAME differs, so match on language and the
      //    other media attributes.
      const renamedOption = { lang, assocLang, characteristics };
      for (let i = 0; i < audioTracks.length; i++) {
        const track = audioTracks[i];
        if (matchesOption(renamedOption, track, audioMatchPredicate)) {
          return i;
        }
      }
      // 3. Fall back to comparing the raw media attributes. Only the listed
      //    identity attributes are compared, so GROUP-ID / NAME differences
      //    between refreshes do not prevent a match.
      for (let i = 0; i < audioTracks.length; i++) {
        const track = audioTracks[i];
        if (
          mediaAttributesIdentical(currentTrack.attrs, track.attrs, [
            'LANGUAGE',
            'ASSOC-LANGUAGE',
            'CHARACTERISTICS',
          ])
        ) {
          return i;
        }
      }
      for (let i = 0; i < audioTracks.length; i++) {
        const track = audioTracks[i];
        if (
          mediaAttributesIdentical(currentTrack.attrs, track.attrs, [
            'LANGUAGE',
          ])
        ) {
          return i;
        }
      }
      // 4. Last resort: same language only, using the parsed lang field.
      const langOnlyOption = { lang, assocLang };
      for (let i = 0; i < audioTracks.length; i++) {
        const track = audioTracks[i];
        if (matchesOption(langOnlyOption, track, audioMatchPredicate)) {
          return i;
        }
      }
    }
    return -1;
  }

  protected loadPlaylist(hlsUrlParameters?: HlsUrlParameters): void {
    super.loadPlaylist();
    const audioTrack = this.currentTrack;
    if (!this.shouldLoadPlaylist(audioTrack)) {
      return;
    }
    // Do not load audio rendition with URI matching main variant URI
    if (useAlternateAudio(audioTrack.url, this.hls)) {
      this.scheduleLoading(audioTrack, hlsUrlParameters);
    }
  }

  protected loadingPlaylist(
    audioTrack: MediaPlaylist,
    hlsUrlParameters: HlsUrlParameters | undefined,
  ) {
    super.loadingPlaylist(audioTrack, hlsUrlParameters);
    const id = audioTrack.id;
    const groupId = audioTrack.groupId as string;
    const url = this.getUrlWithDirectives(audioTrack.url, hlsUrlParameters);
    const details = audioTrack.details;
    const age = details?.age;
    this.log(
      `Loading audio-track ${id} "${audioTrack.name}" lang:${audioTrack.lang} group:${groupId}${
        hlsUrlParameters?.msn !== undefined
          ? ' at sn ' + hlsUrlParameters.msn + ' part ' + hlsUrlParameters.part
          : ''
      }${age && details.live ? ' age ' + age.toFixed(1) + (details.type ? ' ' + details.type || '' : '') : ''} ${url}`,
    );
    this.hls.trigger(Events.AUDIO_TRACK_LOADING, {
      url,
      id,
      groupId,
      deliveryDirectives: hlsUrlParameters || null,
      track: audioTrack,
    });
  }
}

export default AudioTrackController;
