import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import SubtitleTrackController from '../../../src/controller/subtitle-track-controller';
import { Events } from '../../../src/events';
import Hls from '../../../src/hls';
import { LevelDetails } from '../../../src/loader/level-details';
import { LoadStats } from '../../../src/loader/load-stats';
import { AttrList } from '../../../src/utils/attr-list';
import { IMSC1_CODEC } from '../../../src/utils/imsc1-ttml-parser';
import type {
  ComponentAPI,
  NetworkComponentAPI,
} from '../../../src/types/component-api';
import type { Level } from '../../../src/types/level';
import type {
  MediaAttributes,
  MediaPlaylist,
} from '../../../src/types/media-playlist';

use(sinonChai);

type HlsTestable = Omit<
  Hls,
  'levelController' | 'networkControllers' | 'coreComponents'
> & {
  levelController: {
    levels: Pick<Level, 'subtitleGroups'>[];
  };
  coreComponents: ComponentAPI[];
  networkControllers: NetworkComponentAPI[];
};

describe('SubtitleTrackController', function () {
  let hls: HlsTestable;
  let subtitleTrackController: SubtitleTrackController;
  let subtitleTracks: MediaPlaylist[];
  let switchLevel: () => void;
  let videoElement;
  let sandbox;

  beforeEach(function () {
    hls = new Hls({
      enableWebVTT: true,
      enableIMSC1: false,
    }) as unknown as HlsTestable;
    hls.networkControllers.forEach((component) => component.destroy());
    hls.networkControllers.length = 0;
    hls.coreComponents.forEach((component) => component.destroy());
    hls.coreComponents.length = 0;
    subtitleTrackController = new SubtitleTrackController(
      hls as unknown as Hls,
    );
    (hls as any).subtitleTrackController = subtitleTrackController;
    hls.networkControllers.push(subtitleTrackController);
    hls.levelController = {
      levels: [
        {
          subtitleGroups: ['default-text-group'],
        },
      ],
    };

    videoElement = document.createElement('video');
    hls.trigger(Events.MEDIA_ATTACHED, { media: videoElement });

    subtitleTracks = [
      {
        attrs: new AttrList({}) as MediaAttributes,
        autoselect: true,
        bitrate: 0,
        default: false,
        forced: false,
        id: 0,
        groupId: 'default-text-group',
        lang: 'en-US',
        name: 'English',
        type: 'SUBTITLES',
        url: 'baz',
        textCodec: 'webvtt',
        characteristics: 'public.accessibility.transcribes-spoken-dialog',
        // details: { live: false },
      },
      {
        attrs: new AttrList({}) as MediaAttributes,
        autoselect: true,
        bitrate: 0,
        default: false,
        forced: false,
        id: 1,
        groupId: 'default-text-group',
        lang: 'sv',
        name: 'Swedish',
        type: 'SUBTITLES',
        url: 'bar',
        textCodec: 'webvtt',
      },
      {
        attrs: new AttrList({}) as MediaAttributes,
        autoselect: true,
        bitrate: 0,
        default: false,
        forced: false,
        id: 2,
        groupId: 'default-text-group',
        lang: 'en-US',
        name: 'Untitled CC',
        type: 'SUBTITLES',
        url: 'foo',
        characteristics:
          'public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound',
        textCodec: 'webvtt',
        // details: { live: true },
      },
      {
        attrs: new AttrList({}) as MediaAttributes,
        autoselect: true,
        bitrate: 0,
        default: false,
        forced: false,
        id: 3,
        groupId: 'other-text-group', // different groupId
        lang: 'en-US',
        name: 'Untitled CC',
        type: 'SUBTITLES',
        url: 'foo',
        characteristics:
          'public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound',
        textCodec: 'webvtt',
        // details: { live: true },
      },
      {
        attrs: new AttrList({}) as MediaAttributes,
        autoselect: true,
        bitrate: 0,
        default: false,
        forced: false,
        id: 4,
        groupId: 'default-text-group',
        lang: 'en-US',
        name: 'Untitled CC',
        type: 'SUBTITLES',
        url: 'foo',
        characteristics:
          'public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound',
        textCodec: IMSC1_CODEC, // IMSC1 is disabled in this test
        // details: { live: true },
      },
    ];

    const levels = [
      {
        subtitleGroups: ['default-text-group'],
      },
    ] as any;
    hls.trigger(Events.MANIFEST_PARSED, {
      subtitleTracks,
      levels,
      iframeVariants: [],
      audioTracks: [],
      sessionData: null,
      sessionKeys: null,
      firstLevel: 0,
      stats: new LoadStats(),
      audio: true,
      video: true,
      altAudio: true,
    });

    switchLevel = () => {
      hls.trigger(Events.LEVEL_LOADING, {
        id: 0,
        level: 0,
        pathwayId: undefined,
        url: '',
        deliveryDirectives: null,
        levelInfo: {} as any,
      });
    };

    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('text track kind', function () {
    it('the kind of TextTrack should depends on characteristics', function () {
      switchLevel();
      expect(videoElement.textTracks[0].kind).to.equal('subtitles');
      expect(videoElement.textTracks[1].kind).to.equal('subtitles');
      expect(videoElement.textTracks[2].kind).to.equal('captions');
    });
  });

  describe('removable TextTracks', function () {
    it('should remove TextTracks in onMediaDetaching and add them again in onMediaAttached', function () {
      switchLevel();
      expect(videoElement.textTracks.length).to.equal(3);
      hls.trigger(Events.MEDIA_DETACHING, {});
      expect(videoElement.textTracks.length).to.equal(0);
      hls.trigger(Events.MEDIA_ATTACHED, {
        media: videoElement,
      });
      expect(videoElement.textTracks.length).to.equal(3);
    });
  });

  describe('onTextTracksChanged', function () {
    beforeEach(function () {
      switchLevel();
    });

    it('should not respond to unmanaged tracks', function () {
      return new Promise((resolve) => {
        self.setTimeout(() => {
          const triggerSpy = sandbox.spy(hls, 'trigger');

          expect(subtitleTrackController.subtitleTrack).to.equal(-1);
          const track = videoElement.addTextTrack('subtitles', 'foo', 'en');
          track.mode = 'showing';
          self.setTimeout(() => {
            expect(triggerSpy).to.have.not.been.calledWith(
              'hlsSubtitleTrackSwitch',
            );
            expect(track.mode).to.equal('showing');
            resolve(true);
          }, 500);
        }, 0);
      });
    });

    it('should not touch unmanaged tracks', function () {
      return new Promise((resolve) => {
        self.setTimeout(() => {
          expect(subtitleTrackController.subtitleTrack).to.equal(-1);

          const unmanagedTrack = videoElement.addTextTrack(
            'subtitles',
            'foo',
            'en',
          );
          unmanagedTrack.mode = 'showing';

          self.setTimeout(() => {
            hls.once(Events.SUBTITLE_TRACK_SWITCH, () => {
              expect(videoElement.textTracks[1].mode).to.equal('showing');
              expect(unmanagedTrack.mode).to.equal('showing');
              resolve(true);
            });
            subtitleTrackController.subtitleTrack = 1;
          }, 500);
        }, 0);
      });
    });

    it('should set subtitleTrack to -1 and keep unmanagedTrack showing', function () {
      return new Promise((resolve) => {
        self.setTimeout(() => {
          expect(subtitleTrackController.subtitleTrack).to.equal(-1);
          subtitleTrackController.subtitleTrack = 1;

          self.setTimeout(() => {
            expect(subtitleTrackController.subtitleTrack).to.equal(1);

            const unmanagedTrack = videoElement.addTextTrack(
              'subtitles',
              'foo',
              'en',
            );
            unmanagedTrack.mode = 'showing';
            videoElement.textTracks[0].mode = 'disabled';
            videoElement.textTracks[1].mode = 'disabled';
            videoElement.textTracks[2].mode = 'disabled';

            hls.once(Events.SUBTITLE_TRACK_SWITCH, () => {
              expect(subtitleTrackController.subtitleTrack).to.equal(-1);
              expect(unmanagedTrack.mode).to.equal('showing');
              resolve(true);
            });
          }, 500);
        }, 0);
      });
    });

    it('should set subtitleTrack to -1 if disabled', function () {
      return new Promise((resolve) => {
        self.setTimeout(() => {
          expect(subtitleTrackController.subtitleTrack).to.equal(-1);

          const onTextTracksChanged = sinon.spy(
            subtitleTrackController,
            'onTextTracksChanged' as any,
          );

          videoElement.textTracks[0].mode = 'showing';
          self.setTimeout(() => {
            expect(subtitleTrackController.subtitleTrack).to.equal(0);
            expect(onTextTracksChanged).to.have.been.calledOnce;
            videoElement.textTracks[0].mode = 'disabled';
            self.setTimeout(() => {
              expect(subtitleTrackController.subtitleTrack).to.equal(-1);
              expect(onTextTracksChanged).to.have.been.calledTwice;
              resolve(true);
            }, 500);
          }, 500);
        }, 0);
      });
    });

    it('should set subtitleTrack to 0 if hidden', function () {
      return new Promise((resolve) => {
        self.setTimeout(() => {
          expect(subtitleTrackController.subtitleTrack).to.equal(-1);

          videoElement.textTracks[0].mode = 'hidden';
          hls.on(Events.SUBTITLE_TRACK_SWITCH, () => {
            expect(subtitleTrackController.subtitleTrack).to.equal(0);
            resolve(true);
          });
        }, 0);
      });
    });

    it('should set subtitleTrack to 0 if showing', function () {
      return new Promise((resolve) => {
        expect(subtitleTrackController.subtitleTrack).to.equal(-1);

        videoElement.textTracks[0].mode = 'showing';
        self.setTimeout(() => {
          hls.on(Events.SUBTITLE_TRACK_SWITCH, () => {
            expect(subtitleTrackController.subtitleTrack).to.equal(0);
            resolve(true);
          });
        }, 0);
      });
    });

    it('should set subtitleTrack id captions track is showing', function () {
      return new Promise((resolve) => {
        self.setTimeout(() => {
          expect(subtitleTrackController.subtitleTrack).to.equal(-1);

          videoElement.textTracks[2].mode = 'showing';

          hls.on(Events.SUBTITLE_TRACK_SWITCH, () => {
            expect(subtitleTrackController.subtitleTrack).to.equal(2);
            resolve(true);
          });
        }, 0);
      });
    });
  });

  describe('initial track selection', function () {
    it('should not select any tracks if there are no default of forces tracks (ignoring autoselect)', function () {
      switchLevel();
      expect(subtitleTracks[0].autoselect).to.equal(true);
      expect(subtitleTrackController.subtitleTrack).to.equal(-1);
    });

    it('should not select forced tracks', function () {
      subtitleTracks[1].forced = true;
      switchLevel();
      expect(subtitleTrackController.subtitleTrack).to.equal(-1);
    });

    it('should select the default track when there are no forced tracks', function () {
      subtitleTracks[2].default = true;
      switchLevel();
      expect(subtitleTrackController.subtitleTrack).to.equal(2);
    });

    it('should select the first default track when there are no forced tracks', function () {
      subtitleTracks[0].default = true;
      subtitleTracks[1].default = true;
      subtitleTracks[2].default = true;
      switchLevel();
      expect(subtitleTrackController.subtitleTrack).to.equal(0);
    });

    it('should not select forced tracks over the default tracks (one forced track)', function () {
      subtitleTracks[1].default = true;
      subtitleTracks[2].forced = true;
      switchLevel();
      expect(subtitleTrackController.subtitleTrack).to.equal(1);
    });

    it('should not select forced tracks over the default tracks (two forced track)', function () {
      subtitleTracks[0].forced = true;
      subtitleTracks[1].forced = true;
      subtitleTracks[2].default = true;
      switchLevel();
      expect(subtitleTrackController.subtitleTrack).to.equal(2);
    });

    describe('with subtitlePreference', function () {
      it('should select the first track with matching lang', function () {
        hls.config.subtitlePreference = {
          lang: 'en-US',
        };
        subtitleTracks[2].default = true;
        switchLevel();
        expect(subtitleTrackController.subtitleTrack).to.equal(0);
      });
      it('should select the first track with matching properties', function () {
        hls.config.subtitlePreference = {
          lang: 'en-US',
          default: true,
        };
        subtitleTracks[2].default = true;
        switchLevel();
        expect(subtitleTrackController.subtitleTrack).to.equal(2);
      });
      it('should not select default track if an unmatched preference is present', function () {
        hls.config.subtitlePreference = {
          lang: 'none',
        };
        subtitleTracks[2].default = true;
        switchLevel();
        expect(subtitleTrackController.subtitleTrack).to.equal(-1);
      });
    });
  });

  describe('set subtitleTrack', function () {
    beforeEach(function () {
      switchLevel();
    });
    it('should set active text track mode to showing', function () {
      videoElement.textTracks[0].mode = 'disabled';

      subtitleTrackController.subtitleDisplay = true;
      subtitleTrackController.subtitleTrack = 0;

      expect(videoElement.textTracks[0].mode).to.equal('showing');
    });

    it('should set active text track mode to hidden', function () {
      videoElement.textTracks[0].mode = 'disabled';
      subtitleTrackController.subtitleDisplay = false;
      subtitleTrackController.subtitleTrack = 0;

      expect(videoElement.textTracks[0].mode).to.equal('hidden');
    });

    it('should disable previous track', function () {
      return new Promise((resolve) => {
        self.setTimeout(() => {
          expect(subtitleTrackController.subtitleTrack).to.equal(-1);

          const onTextTracksChanged = sinon.spy(
            subtitleTrackController,
            'onTextTracksChanged' as any,
          );

          videoElement.textTracks[0].mode = 'showing';
          self.setTimeout(() => {
            expect(subtitleTrackController.subtitleTrack).to.equal(0);
            expect(videoElement.textTracks[0].mode).to.equal('showing');
            expect(onTextTracksChanged).to.have.been.calledOnce;
            subtitleTrackController.subtitleTrack = 1;
            self.setTimeout(() => {
              expect(videoElement.textTracks[0].mode).to.equal('disabled');
              expect(videoElement.textTracks[1].mode).to.equal('showing');
              expect(onTextTracksChanged).to.have.been.calledTwice;
              resolve(true);
            }, 500);
          }, 500);
        }, 0);
      });
    });

    it('should disable all textTracks when set to -1', function () {
      [].slice.call(videoElement.textTracks).forEach((t) => {
        t.mode = 'showing';
      });
      expect(subtitleTrackController.subtitleTrack).to.equal(-1);
      subtitleTrackController.subtitleTrack = -1;
      [].slice.call(videoElement.textTracks).forEach((t) => {
        expect(t.mode).to.equal('disabled');
      });
    });

    it('should trigger SUBTITLE_TRACK_SWITCH', function () {
      const triggerSpy = sandbox.spy(hls, 'trigger');
      subtitleTrackController.startLoad();
      subtitleTrackController.subtitleTrack = 1;

      expect(triggerSpy).to.have.been.calledTwice;
      expect(triggerSpy.firstCall).to.have.been.calledWith(
        'hlsSubtitleTrackSwitch',
        {
          id: 1,
          groupId: 'default-text-group',
          name: 'Swedish',
          type: 'SUBTITLES',
          url: 'bar',
        },
      );
    });

    it('should trigger SUBTITLE_TRACK_LOADING if the track has no details', function () {
      const triggerSpy = sandbox.spy(hls, 'trigger');
      subtitleTrackController.startLoad();
      subtitleTrackController.subtitleTrack = 1;

      expect(triggerSpy).to.have.been.calledTwice;
      expect(triggerSpy.secondCall).to.have.been.calledWith(
        'hlsSubtitleTrackLoading',
        {
          url: 'bar',
          id: 1,
          groupId: 'default-text-group',
          deliveryDirectives: null,
          track: subtitleTrackController.subtitleTracks[1],
        },
      );
    });

    it('should not trigger SUBTITLE_TRACK_LOADING if the track has details and is not live', function () {
      const triggerSpy = sandbox.spy(hls, 'trigger');
      subtitleTracks[0].details = { live: false } as any;
      subtitleTrackController.startLoad();
      subtitleTrackController.subtitleTrack = 0;

      expect(triggerSpy).to.have.been.calledOnce;
      expect(triggerSpy.firstCall).to.have.been.calledWith(
        'hlsSubtitleTrackSwitch',
        {
          id: 0,
          groupId: 'default-text-group',
          name: 'English',
          type: 'SUBTITLES',
          url: 'baz',
        },
      );
    });

    it('should trigger SUBTITLE_TRACK_LOADING if the track is live and needs to be reloaded', function () {
      const triggerSpy = sandbox.spy(hls, 'trigger');
      subtitleTracks[2].details = {
        live: true,
        requestScheduled: -100000,
        targetduration: 2,
      } as any;
      subtitleTrackController.startLoad();
      subtitleTrackController.subtitleTrack = 2;

      expect(triggerSpy).to.have.been.calledTwice;
      expect(triggerSpy.secondCall).to.have.been.calledWith(
        'hlsSubtitleTrackLoading',
        {
          url: 'foo',
          id: 2,
          groupId: 'default-text-group',
          deliveryDirectives: null,
          track: subtitleTrackController.subtitleTracks[2],
        },
      );
    });

    it('should do nothing if called with out of bound indices', function () {
      const triggerSpy = sandbox.spy(hls, 'trigger');
      subtitleTrackController.subtitleTrack = 5;
      subtitleTrackController.subtitleTrack = -2;
      expect(triggerSpy).to.have.callCount(0);
      expect(subtitleTrackController.subtitleTrack).to.equal(-1);
    });

    it('should do nothing if called with a invalid index', function () {
      const triggerSpy = sandbox.spy(hls, 'trigger');
      subtitleTrackController.subtitleTrack = undefined as any;
      subtitleTrackController.subtitleTrack = null as any;
      expect(triggerSpy).to.have.callCount(0);
      expect(subtitleTrackController.subtitleTrack).to.equal(-1);
    });
  });

  describe('toggleTrackModes', function () {
    // This can be the case when setting the subtitleTrack before Hls.js attaches to the mediaElement
    it('should not throw an exception if trackId is out of the mediaElement text track bounds', function () {
      switchLevel();
      hls.detachMedia();
      const toggleTrackModesSpy = sandbox.spy(
        subtitleTrackController,
        'toggleTrackModes',
      );
      (subtitleTrackController as any).trackId = 3;
      hls.trigger(Events.MEDIA_ATTACHED, { media: videoElement });
      subtitleTrackController.subtitleDisplay = true; // setting subtitleDisplay invokes `toggleTrackModes`
      expect(toggleTrackModesSpy).to.have.been.calledOnce;
    });
  });

  describe('onSubtitleTrackLoaded', function () {
    beforeEach(function () {
      switchLevel();
    });
    it('exits early if the loaded track does not match the requested track', function () {
      const playlistLoadedSpy = sandbox.spy(
        subtitleTrackController,
        'playlistLoaded',
      );
      subtitleTrackController.startLoad();
      (subtitleTrackController as any).trackId = 1;
      (subtitleTrackController as any).currentTrack = subtitleTracks[1];

      const mockLoadedEvent = {
        id: 999,
        groupId: 'default-text-group',
        details: { foo: 'bar' } as any,
        stats: new LoadStats(),
        networkDetails: new Response('ok'),
        deliveryDirectives: null,
        track: {} as any,
      };
      hls.trigger(Events.SUBTITLE_TRACK_LOADED, mockLoadedEvent);
      expect((subtitleTrackController as any).timer).to.equal(-1);
      expect(playlistLoadedSpy).to.have.not.been.called;

      mockLoadedEvent.id = 0;
      hls.trigger(Events.SUBTITLE_TRACK_LOADED, mockLoadedEvent);
      expect((subtitleTrackController as any).timer).to.equal(-1);
      expect(playlistLoadedSpy).to.have.not.been.called;

      mockLoadedEvent.id = 1;
      hls.trigger(Events.SUBTITLE_TRACK_LOADED, mockLoadedEvent);
      expect((subtitleTrackController as any).timer).to.equal(-1);
      expect(playlistLoadedSpy).to.have.been.calledOnce;
    });

    it('retains loaded details on track if active track synchronously set to something else', function () {
      const playlistLoadedSpy = sandbox.spy(
        subtitleTrackController,
        'playlistLoaded',
      );
      subtitleTrackController.startLoad();
      (subtitleTrackController as any).trackId = 1;
      (subtitleTrackController as any).currentTrack = subtitleTracks[1];

      const mockLoadedEvent = {
        id: 1,
        groupId: 'default-text-group',
        details: { foo: 'bar' } as any,
        stats: new LoadStats(),
        networkDetails: new Response('ok'),
        deliveryDirectives: null,
        track: {} as any,
      };

      hls.subtitleTrack = -1;
      hls.trigger(Events.SUBTITLE_TRACK_LOADED, mockLoadedEvent);

      expect(subtitleTracks[1].details).not.to.be.undefined;
      expect((subtitleTrackController as any).timer).to.equal(-1);
      // hls.js will not emit playlist loaded since the trackId does not match the loaded event id
      expect(playlistLoadedSpy).to.have.not.been.called;

      expect((subtitleTrackController as any).tracksInGroup[1]).not.to.be
        .undefined;
      expect((subtitleTrackController as any).tracksInGroup[1].details).not.to
        .be.undefined;
    });

    it('does not set the reload timer if loading has not started', function () {
      const details = new LevelDetails('');
      subtitleTrackController.stopLoad();
      (subtitleTrackController as any).trackId = 1;
      (subtitleTrackController as any).currentTrack = subtitleTracks[1];
      hls.trigger(Events.SUBTITLE_TRACK_LOADED, {
        id: 1,
        groupId: 'default-text-group',
        details,
        stats: new LoadStats(),
        networkDetails: new Response('ok'),
        deliveryDirectives: null,
        track: {} as any,
      });
      expect((subtitleTrackController as any).timer).to.equal(-1);
    });

    it('sets the live reload timer if the level is live', function () {
      const details = new LevelDetails('');
      subtitleTrackController.startLoad();
      (subtitleTrackController as any).trackId = 1;
      (subtitleTrackController as any).currentTrack = subtitleTracks[1];
      hls.trigger(Events.SUBTITLE_TRACK_LOADED, {
        id: 1,
        groupId: 'default-text-group',
        details,
        stats: new LoadStats(),
        networkDetails: new Response('ok'),
        deliveryDirectives: null,
        track: {} as any,
      });
      expect((subtitleTrackController as any).timer).to.exist;
    });

    it('stops the live reload timer if the level is not live', function () {
      const details = new LevelDetails('');
      details.live = false;
      (subtitleTrackController as any).trackId = 1;
      (subtitleTrackController as any).currentTrack = subtitleTracks[1];
      (subtitleTrackController as any).timer = self.setTimeout(() => {}, 0);
      hls.trigger(Events.SUBTITLE_TRACK_LOADED, {
        id: 1,
        groupId: 'default-text-group',
        details,
        stats: new LoadStats(),
        networkDetails: new Response('ok'),
        deliveryDirectives: null,
        track: {} as any,
      });
      expect((subtitleTrackController as any).timer).to.equal(-1);
    });
  });

  describe('stopLoad', function () {
    it('stops loading', function () {
      const clearReloadSpy = sandbox.spy(subtitleTrackController, 'clearTimer');
      subtitleTrackController.stopLoad();
      expect((subtitleTrackController as any).canLoad).to.be.false;
      expect(clearReloadSpy).to.have.been.calledOnce;
    });
  });

  describe('startLoad', function () {
    it('starts loading', function () {
      const loadCurrentTrackSpy = sandbox.spy(
        subtitleTrackController,
        'loadPlaylist',
      );
      subtitleTrackController.startLoad();
      expect((subtitleTrackController as any).canLoad).to.be.true;
      expect(loadCurrentTrackSpy).to.have.been.calledOnce;
    });
  });

  describe('subtitle track group-ID refresh', function () {
    const makeSubtitleTrack = (
      name: string,
      lang: string,
      groupId: string,
      isDefault: boolean,
    ): MediaPlaylist => ({
      attrs: new AttrList({
        'GROUP-ID': groupId,
        NAME: name,
        LANGUAGE: lang,
        DEFAULT: isDefault ? 'YES' : 'NO',
        AUTOSELECT: 'YES',
      }) as MediaAttributes,
      autoselect: true,
      bitrate: 0,
      default: isDefault,
      forced: false,
      id: 0,
      groupId,
      lang,
      name,
      type: 'SUBTITLES',
      url: `${name}.vtt`,
      textCodec: 'webvtt',
    });

    it('maps an explicit user selection to the equivalent track in the new group and emits a single change', function () {
      const zhMain = makeSubtitleTrack('zh-main', 'zh', 'old-group', false);
      const enMain = makeSubtitleTrack('en-main', 'en', 'old-group', true);
      const enMainV2 = makeSubtitleTrack(
        'en-main-v2',
        'en',
        'new-group',
        true,
      );
      const zhMainV2 = makeSubtitleTrack(
        'zh-main-v2',
        'zh',
        'new-group',
        false,
      );

      hls.levelController = {
        levels: [{ subtitleGroups: ['old-group'] }],
      };
      hls.trigger(Events.MANIFEST_PARSED, {
        subtitleTracks: [zhMain, enMain],
        levels: [],
        iframeVariants: [],
        audioTracks: [],
        sessionData: null,
        sessionKeys: null,
        firstLevel: 0,
        stats: new LoadStats(),
        audio: true,
        video: true,
        altAudio: true,
      });
      switchLevel();

      // User explicitly selects the Chinese subtitle track
      subtitleTrackController.subtitleTrack = 0;
      expect(subtitleTrackController.subtitleTracks[0]).to.equal(zhMain);

      const updatedSpy = sandbox.spy();
      const switchSpy = sandbox.spy();
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, updatedSpy);
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, switchSpy);

      // Manifest refresh: old group removed, equivalent tracks in new group
      hls.levelController = {
        levels: [{ subtitleGroups: ['new-group'] }],
      };
      hls.trigger(Events.MANIFEST_PARSED, {
        subtitleTracks: [enMainV2, zhMainV2],
        levels: [],
        iframeVariants: [],
        audioTracks: [],
        sessionData: null,
        sessionKeys: null,
        firstLevel: 0,
        stats: new LoadStats(),
        audio: true,
        video: true,
        altAudio: true,
      });
      switchLevel();

      const selectedTrack =
        subtitleTrackController.subtitleTracks[
          subtitleTrackController.subtitleTrack
        ];
      expect(
        selectedTrack,
        'subtitleTrack query points at zh-main-v2',
      ).to.equal(zhMainV2);
      expect(
        subtitleTrackController.subtitleTracks.indexOf(zhMainV2),
        'both queries resolve to the same new-group track',
      ).to.equal(subtitleTrackController.subtitleTrack);

      expect(updatedSpy).to.have.been.calledOnce;
      expect(switchSpy).to.have.been.calledOnce;
      expect(switchSpy).to.have.been.calledWith(
        Events.SUBTITLE_TRACK_SWITCH,
        sinon.match({
          name: 'zh-main-v2',
          groupId: 'new-group',
        }),
      );
    });

    it('keeps the default-track consumer on the equivalent track when group-IDs change', function () {
      const zhMain = makeSubtitleTrack('zh-main', 'zh', 'old-group', true);
      const enMain = makeSubtitleTrack('en-main', 'en', 'old-group', false);
      const enMainV2 = makeSubtitleTrack(
        'en-main-v2',
        'en',
        'new-group',
        true,
      );
      const zhMainV2 = makeSubtitleTrack(
        'zh-main-v2',
        'zh',
        'new-group',
        false,
      );

      hls.levelController = {
        levels: [{ subtitleGroups: ['old-group'] }],
      };
      hls.trigger(Events.MANIFEST_PARSED, {
        subtitleTracks: [zhMain, enMain],
        levels: [],
        iframeVariants: [],
        audioTracks: [],
        sessionData: null,
        sessionKeys: null,
        firstLevel: 0,
        stats: new LoadStats(),
        audio: true,
        video: true,
        altAudio: true,
      });
      switchLevel();
      expect(
        subtitleTrackController.subtitleTracks[
          subtitleTrackController.subtitleTrack
        ],
      ).to.equal(zhMain);

      const switchSpy = sandbox.spy();
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, switchSpy);

      // Refresh makes English the new default; an equivalent Chinese track exists
      hls.levelController = {
        levels: [{ subtitleGroups: ['new-group'] }],
      };
      hls.trigger(Events.MANIFEST_PARSED, {
        subtitleTracks: [enMainV2, zhMainV2],
        levels: [],
        iframeVariants: [],
        audioTracks: [],
        sessionData: null,
        sessionKeys: null,
        firstLevel: 0,
        stats: new LoadStats(),
        audio: true,
        video: true,
        altAudio: true,
      });
      switchLevel();

      const selectedTrack =
        subtitleTrackController.subtitleTracks[
          subtitleTrackController.subtitleTrack
        ];
      expect(selectedTrack, 'default consumer stays on Chinese equivalent')
        .to.equal(zhMainV2);
      expect(switchSpy).to.have.been.calledOnce;
      expect(switchSpy).to.have.been.calledWith(
        Events.SUBTITLE_TRACK_SWITCH,
        sinon.match({ name: 'zh-main-v2' }),
      );
    });

    it('falls back to the new default track and notifies once when no equivalent track exists', function () {
      const zhMain = makeSubtitleTrack('zh-main', 'zh', 'old-group', false);
      const enMain = makeSubtitleTrack('en-main', 'en', 'old-group', true);
      const frMainV2 = makeSubtitleTrack(
        'fr-main-v2',
        'fr',
        'new-group',
        true,
      );

      hls.levelController = {
        levels: [{ subtitleGroups: ['old-group'] }],
      };
      hls.trigger(Events.MANIFEST_PARSED, {
        subtitleTracks: [zhMain, enMain],
        levels: [],
        iframeVariants: [],
        audioTracks: [],
        sessionData: null,
        sessionKeys: null,
        firstLevel: 0,
        stats: new LoadStats(),
        audio: true,
        video: true,
        altAudio: true,
      });
      switchLevel();
      subtitleTrackController.subtitleTrack = 0;

      const switchSpy = sandbox.spy();
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, switchSpy);

      // Refresh: the new group has no Chinese equivalent
      hls.levelController = {
        levels: [{ subtitleGroups: ['new-group'] }],
      };
      hls.trigger(Events.MANIFEST_PARSED, {
        subtitleTracks: [frMainV2],
        levels: [],
        iframeVariants: [],
        audioTracks: [],
        sessionData: null,
        sessionKeys: null,
        firstLevel: 0,
        stats: new LoadStats(),
        audio: true,
        video: true,
        altAudio: true,
      });
      switchLevel();

      const selectedTrack =
        subtitleTrackController.subtitleTracks[
          subtitleTrackController.subtitleTrack
        ];
      expect(selectedTrack, 'falls back to the only new-group default track')
        .to.equal(frMainV2);
      expect(switchSpy, 'single fallback notification').to.have.been
        .calledOnce;
      expect(switchSpy).to.have.been.calledWith(
        Events.SUBTITLE_TRACK_SWITCH,
        sinon.match({ name: 'fr-main-v2' }),
      );
    });

    it('preserves the selection across a renamed group refresh when attributes lack language info', function () {
      const makeBareTrack = (
        name: string,
        lang: string,
        groupId: string,
        isDefault: boolean,
      ): MediaPlaylist => ({
        attrs: new AttrList({}) as MediaAttributes,
        autoselect: true,
        bitrate: 0,
        default: isDefault,
        forced: false,
        id: 0,
        groupId,
        lang,
        name,
        type: 'SUBTITLES',
        url: `${name}.vtt`,
        textCodec: 'webvtt',
      });
      const manifestData = (subtitleTracks: MediaPlaylist[]) => ({
        subtitleTracks,
        levels: [],
        iframeVariants: [],
        audioTracks: [],
        sessionData: null,
        sessionKeys: null,
        firstLevel: 0,
        stats: new LoadStats(),
        audio: true,
        video: true,
        altAudio: true,
      });

      const zhMain = makeBareTrack('zh-main', 'zh', 'old-group', false);
      const enMain = makeBareTrack('en-main', 'en', 'old-group', true);
      const enMainV2 = makeBareTrack(
        'en-main-v2',
        'en',
        'new-group',
        true,
      );
      const zhMainV2 = makeBareTrack(
        'zh-main-v2',
        'zh',
        'new-group',
        false,
      );

      hls.levelController = {
        levels: [{ subtitleGroups: ['old-group'] }],
      };
      hls.trigger(
        Events.MANIFEST_PARSED,
        manifestData([zhMain, enMain]),
      );
      switchLevel();
      subtitleTrackController.subtitleTrack = 0;

      const switchSpy = sandbox.spy();
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, switchSpy);

      hls.levelController = {
        levels: [{ subtitleGroups: ['new-group'] }],
      };
      hls.trigger(
        Events.MANIFEST_PARSED,
        manifestData([enMainV2, zhMainV2]),
      );
      switchLevel();

      const selectedTrack =
        subtitleTrackController.subtitleTracks[
          subtitleTrackController.subtitleTrack
        ];
      expect(selectedTrack).to.equal(zhMainV2);
      expect(switchSpy).to.have.been.calledOnce;
      expect(switchSpy).to.have.been.calledWith(
        Events.SUBTITLE_TRACK_SWITCH,
        sinon.match({ name: 'zh-main-v2' }),
      );
    });
  });
});
