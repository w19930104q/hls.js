import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import { Fragment } from '../../../src/loader/fragment';
import { LevelDetails } from '../../../src/loader/level-details';
import { Level } from '../../../src/types/level';
import { PlaylistLevelType } from '../../../src/types/loader';
import { AttrList } from '../../../src/utils/attr-list';
import {
  adjustSlidingStart,
  alignDiscontinuities,
  alignMediaPlaylistByPDT,
  alignStream,
  shouldAlignOnDiscontinuities,
} from '../../../src/utils/discontinuities';
import { mergeDetails } from '../../../src/utils/level-helper';
import { logger } from '../../../src/utils/logger';
import type { MediaFragment } from '../../../src/loader/fragment';

use(sinonChai);

const mockReferenceFrag = objToFragment({
  start: 20,
  duration: 4,
  cc: 0,
});

const mockFrags = [
  {
    start: 0,
    duration: 4,
    cc: 0,
  },
  {
    start: 4,
    duration: 4,
    cc: 1,
  },
  {
    start: 8,
    duration: 8,
    cc: 1,
  },
];

describe('discontinuities', function () {
  it('adjusts level fragments with overlapping CC range using a reference fragment', function () {
    const details = objToLevelDetails({
      fragments: mockFrags.map(objToFragment),
      PTSKnown: false,
      alignedSliding: false,
    });
    const expected = [
      {
        start: 20,
        duration: 4,
        cc: 0,
      },
      {
        start: 24,
        duration: 4,
        cc: 1,
      },
      {
        start: 28,
        duration: 8,
        cc: 1,
      },
    ].map(objToFragment);

    adjustSlidingStart(mockReferenceFrag.start, details);
    expect(details.fragments).to.deep.equal(expected);
    expect(details.alignedSliding).to.be.true;
  });

  it('aligns level fragments times based on PDT and start time of reference level details', function () {
    const lastLevel = {
      details: objToLevelDetails({
        PTSKnown: false,
        alignedSliding: false,
        startCC: 0,
        endCC: 0,
        fragments: [
          {
            start: 18,
            duration: 2,
            programDateTime: 1629821766107,
          },
          {
            start: 20,
            duration: 2,
            programDateTime: 1629821768107,
          },
          {
            start: 22,
            duration: 8,
            programDateTime: 1629821770107,
          },
        ].map(objToFragment),
        fragmentHint: objToFragment({
          start: 30,
          duration: 2,
          programDateTime: 1629821778107,
        }),
      }),
    };

    const refDetails = objToLevelDetails({
      fragments: [
        {
          start: 18,
          duration: 2,
          programDateTime: 1629821768107,
        },
      ].map(objToFragment),
      PTSKnown: false,
      alignedSliding: false,
      startCC: 0,
      endCC: 0,
    });

    const detailsExpected = objToLevelDetails({
      fragments: [
        {
          start: 16,
          duration: 2,
          programDateTime: 1629821766107,
        },
        {
          start: 18,
          duration: 2,
          programDateTime: 1629821768107,
        },
        {
          start: 20,
          duration: 8,
          programDateTime: 1629821770107,
        },
      ].map(objToFragment),
      fragmentHint: objToFragment({
        start: 28,
        duration: 2,
        programDateTime: 1629821778107,
      }),
      PTSKnown: false,
      alignedSliding: true,
      startCC: 0,
      endCC: 0,
    });
    alignMediaPlaylistByPDT(lastLevel.details, refDetails, logger);
    expect(
      lastLevel.details,
      `actual:\n\n${JSON.stringify(
        lastLevel.details,
        null,
        2,
      )}\n\nexpected\n\n${JSON.stringify(detailsExpected, null, 2)}`,
    ).to.deep.equal(detailsExpected);
  });

  it('aligns level fragments with overlapping CC bounds and discontiguous programDateTime info', function () {
    const lastLevel = objToLevel({
      details: objToLevelDetails({
        PTSKnown: true,
        alignedSliding: false,
        startCC: 1,
        endCC: 3,
        fragments: [
          {
            start: 20,
            duration: 4,
            cc: 1,
            programDateTime: 1503892800000,
          },
          {
            start: 24,
            duration: 4,
            cc: 2,
            programDateTime: 1503892850000,
          },
          {
            start: 28,
            duration: 8,
            cc: 3,
            programDateTime: 1501111110000,
          },
          {
            start: 28,
            duration: 8,
            cc: 3,
            programDateTime: 1501111118000,
          },
        ].map(objToFragment),
      }),
    });

    const details = objToLevelDetails({
      fragments: [
        {
          start: 0,
          duration: 4,
          cc: 2,
          programDateTime: 1503892850000,
        },
        {
          start: 4,
          duration: 4,
          cc: 3,
          programDateTime: 1501111110000,
        },
        {
          start: 8,
          duration: 4,
          cc: 3,
          programDateTime: 1501111114000,
        },
        {
          start: 12,
          duration: 4,
          cc: 4,
          programDateTime: 1503892854000,
        },
      ].map(objToFragment),
      PTSKnown: false,
      alignedSliding: false,
      startCC: 2,
      endCC: 4,
    });

    const detailsExpected = objToLevelDetails({
      fragments: [
        {
          start: 24,
          duration: 4,
          cc: 2,
          programDateTime: 1503892850000,
        },
        {
          start: 28,
          duration: 4,
          cc: 3,
          programDateTime: 1501111110000,
        },
        {
          start: 32,
          duration: 4,
          cc: 3,
          programDateTime: 1501111114000,
        },
        {
          start: 36,
          duration: 4,
          cc: 4,
          programDateTime: 1503892854000,
        },
      ].map(objToFragment),
      PTSKnown: false,
      alignedSliding: true,
      startCC: 2,
      endCC: 4,
    });
    alignMediaPlaylistByPDT(details, lastLevel.details as LevelDetails, logger);
    expect(details).to.deep.equal(detailsExpected);
  });

  it('adjusts level fragments without overlapping CC range but with programDateTime info no more than one minute or the playlist duration apart', function () {
    const lastLevel = {
      details: objToLevelDetails({
        PTSKnown: true,
        alignedSliding: false,
        startCC: 0,
        endCC: 1,
        fragments: [
          {
            start: 20,
            duration: 4,
            cc: 0,
            programDateTime: 1503892800000,
          },
          {
            start: 24,
            duration: 4,
            cc: 1,
            programDateTime: 1503892804000,
          },
          {
            start: 28,
            duration: 8,
            cc: 1,
            programDateTime: 1503892808000,
          },
        ].map(objToFragment),
      }),
    };

    const details = objToLevelDetails({
      fragments: [
        {
          start: 0,
          duration: 4,
          cc: 2,
          programDateTime: 1503892850000,
        },
        {
          start: 4,
          duration: 4,
          cc: 2,
          programDateTime: 1503892854000,
        },
        {
          start: 8,
          duration: 8,
          cc: 3,
          programDateTime: 1503892858000,
        },
      ].map(objToFragment),
      PTSKnown: false,
      alignedSliding: false,
      startCC: 2,
      endCC: 3,
    });

    const detailsExpected = objToLevelDetails({
      fragments: [
        {
          start: 70,
          duration: 4,
          cc: 2,
          programDateTime: 1503892850000,
          stats: details.fragments[0].stats,
        },
        {
          start: 74,
          duration: 4,
          cc: 2,
          programDateTime: 1503892854000,
          stats: details.fragments[1].stats,
        },
        {
          start: 78,
          duration: 8,
          cc: 3,
          programDateTime: 1503892858000,
          stats: details.fragments[2].stats,
        },
      ].map(objToFragment),
      PTSKnown: false,
      alignedSliding: true,
      startCC: 2,
      endCC: 3,
    });
    alignMediaPlaylistByPDT(details, lastLevel.details, logger);

    expect(detailsExpected).to.deep.equal(
      details,
      JSON.stringify(details, null, 2),
    );
  });

  describe('alignDiscontinuities', function () {
    it('aligns playlists (LevelDetails fragments starts) based on overlapping discontinuity sequence change', function () {
      const prevDetails = objToLevelDetails({
        fragments: [mockReferenceFrag, { start: 24, duration: 4, cc: 1 }].map(
          objToFragment,
        ),
      });
      const curDetails = objToLevelDetails({
        fragments: mockFrags.map(objToFragment),
      });
      alignDiscontinuities(curDetails, prevDetails, logger);
      expect(curDetails).to.have.property('alignedSliding').which.is.true;
      expect(curDetails.fragments[0].start).to.equal(20);
    });

    it('aligns playlists (LevelDetails fragments starts) based on overlapping discontinuity sequence change even when older playlist is newer', function () {
      const prevDetails = objToLevelDetails({
        fragments: [
          mockReferenceFrag,
          { start: 24, duration: 4, cc: 1 },
          { start: 28, duration: 4, cc: 2 },
        ].map(objToFragment),
      });
      const curDetails = objToLevelDetails({
        fragments: mockFrags.map(objToFragment),
      });
      alignDiscontinuities(curDetails, prevDetails, logger);
      expect(curDetails).to.have.property('alignedSliding').which.is.true;
      expect(curDetails.fragments[0].start).to.equal(20);
    });

    it('aligns playlists (LevelDetails fragments starts) based on overlapping discontinuity sequence change using latest disco', function () {
      const prevDetails = objToLevelDetails({
        fragments: [
          mockReferenceFrag,
          { start: 24, duration: 4.5, cc: 1 },
          { start: 28.5, duration: 4, cc: 2 },
        ].map(objToFragment),
      });
      const curDetails = objToLevelDetails({
        fragments: [
          { start: 0, duration: 4.5, cc: 1 },
          { start: 4.5, duration: 4, cc: 2 },
          { start: 8.5, duration: 4, cc: 3 },
        ].map(objToFragment),
      });
      alignDiscontinuities(curDetails, prevDetails, logger);
      expect(curDetails).to.have.property('alignedSliding').which.is.true;
      expect(curDetails.fragments[0].start).to.equal(24);
    });

    it('does not aligns playlists if there are no frags in the previous level', function () {
      const curDetails = objToLevelDetails({
        fragments: mockFrags.map(objToFragment),
      });
      alignDiscontinuities(
        curDetails,
        objToLevelDetails({ fragments: [] }),
        logger,
      );
      expect(curDetails).to.have.property('alignedSliding').which.is.false;
      expect(curDetails.fragments[0].start).to.equal(0);
    });

    it('does not aligns playlists if there is no matching discontinuity sequence change', function () {
      const curDetails = objToLevelDetails({
        fragments: mockFrags.map(objToFragment),
      });
      alignDiscontinuities(
        curDetails,
        objToLevelDetails({ fragments: [{ cc: 10 }].map(objToFragment) }),
        logger,
      );
      expect(curDetails).to.have.property('alignedSliding').which.is.false;
      expect(curDetails.fragments[0].start).to.equal(0);
    });

    it('does not aligns playlists if there are no frags in the current level', function () {
      const curDetails = objToLevelDetails({
        fragments: [],
      });
      alignDiscontinuities(
        curDetails,
        objToLevelDetails({ fragments: [{ cc: 0 }].map(objToFragment) }),
        logger,
      );
      expect(curDetails).to.have.property('alignedSliding').which.is.false;
    });
  });

  it('should align current level when there is overlap in discontinuity sequence change', function () {
    const lastLevelDetails = objToLevelDetails({
      startCC: 0,
      endCC: 1,
    });
    const curDetails = objToLevelDetails({
      startCC: 0,
      endCC: 1,
    });

    const actual = shouldAlignOnDiscontinuities(lastLevelDetails, curDetails);
    expect(actual).to.be.true;
  });

  it('should align current level when there is any overlap in discontinuity sequence change', function () {
    const lastLevelDetails = objToLevelDetails({
      startCC: 0,
      endCC: 2,
    });
    const curDetails = objToLevelDetails({
      startCC: 1,
      endCC: 3,
    });

    const actual = shouldAlignOnDiscontinuities(lastLevelDetails, curDetails);
    expect(actual).to.be.true;
  });

  it('should not align current level there is no overlap in discontinuity sequence change', function () {
    const lastLevelDetails = objToLevelDetails({
      startCC: 0,
      endCC: 1,
    });
    const curDetails = objToLevelDetails({
      startCC: 1,
      endCC: 2,
    });

    const actual = shouldAlignOnDiscontinuities(lastLevelDetails, curDetails);
    expect(actual).to.be.false;
  });

  it('should not align when there is no CC increase', function () {
    const lastLevelDetails = objToLevelDetails({
      startCC: 1,
      endCC: 1,
    });
    const curDetails = objToLevelDetails({
      startCC: 1,
      endCC: 1,
    });
    const actual = shouldAlignOnDiscontinuities(lastLevelDetails, curDetails);
    expect(actual).to.be.false;
  });

  it('should not align when there are no previous level details', function () {
    const curDetails = objToLevelDetails({
      startCC: 1,
      endCC: 1,
    });
    const actual = shouldAlignOnDiscontinuities(undefined, curDetails);
    expect(actual).to.be.false;
  });

  describe('alignStream with matching media sequence numbers', function () {
    // Live channel whose levels share segment numbering. Both levels enter a
    // new discontinuity sequence after the second segment. Level A reports
    // program date times from noon sharp; a reload of level B reports its
    // first program date time 720ms later.
    const NOON = Date.UTC(2026, 10, 25, 12, 0, 0, 0);
    const SEGMENT_DURATION = 6;

    function numberedFrag(
      sn: number,
      cc: number,
      start: number,
      pdtOffsetMs: number,
      type: PlaylistLevelType = PlaylistLevelType.MAIN,
    ): MediaFragment {
      const fragment = new Fragment(type, '') as MediaFragment;
      fragment.sn = sn;
      fragment.cc = cc;
      fragment.setStart(start);
      fragment.setDuration(SEGMENT_DURATION);
      fragment.programDateTime = NOON + pdtOffsetMs;
      return fragment;
    }

    function levelA(): LevelDetails {
      // sn 100-110, discontinuity after the second segment, PDT from noon
      const fragments: MediaFragment[] = [];
      for (let sn = 100; sn <= 110; sn++) {
        fragments.push(
          numberedFrag(
            sn,
            sn < 102 ? 5 : 6,
            (sn - 100) * SEGMENT_DURATION,
            (sn - 100) * SEGMENT_DURATION * 1000,
          ),
        );
      }
      return numberedDetails(fragments);
    }

    function levelB(startSN: number, pdtOffsetMs: number): LevelDetails {
      // reloaded playlist: window slid past the discontinuity, program date
      // times nudged by pdtOffsetMs relative to level A
      const fragments: MediaFragment[] = [];
      for (let sn = startSN; sn <= 110; sn++) {
        fragments.push(
          numberedFrag(
            sn,
            6,
            (sn - startSN) * SEGMENT_DURATION,
            (sn - 100) * SEGMENT_DURATION * 1000 + pdtOffsetMs,
          ),
        );
      }
      return numberedDetails(fragments);
    }

    function audioLevel(startSN: number, pdtOffsetMs: number): LevelDetails {
      const fragments: MediaFragment[] = [];
      for (let sn = startSN; sn <= 110; sn++) {
        fragments.push(
          numberedFrag(
            sn,
            6,
            (sn - startSN) * SEGMENT_DURATION,
            (sn - 100) * SEGMENT_DURATION * 1000 + pdtOffsetMs,
            PlaylistLevelType.AUDIO,
          ),
        );
      }
      return numberedDetails(fragments);
    }

    function numberedDetails(fragments: MediaFragment[]): LevelDetails {
      const details = objToLevelDetails({ fragments });
      details.startSN = fragments[0].sn as number;
      details.endSN = fragments[fragments.length - 1].sn as number;
      details.targetduration = SEGMENT_DURATION;
      return details;
    }

    function startOfSN(details: LevelDetails, sn: number): number {
      return details.fragments.filter((frag) => frag.sn === sn)[0].start;
    }

    function snAtTime(
      details: LevelDetails,
      time: number,
    ): number | string | null {
      const frag = details.fragments.filter(
        (frag) => time >= frag.start && time < frag.start + frag.duration,
      )[0];
      return frag ? frag.sn : null;
    }

    it('keeps the established content mapping when the reloaded playlist program date time is 720ms later', function () {
      const detailsA = levelA();
      const detailsB = levelB(102, 720);
      alignStream(detailsA, detailsB, logger);
      expect(detailsB.alignedSliding).to.be.true;
      // the same content fragments share the same start in both levels
      expect(startOfSN(detailsB, 102)).to.equal(startOfSN(detailsA, 102));
      expect(startOfSN(detailsB, 107)).to.equal(startOfSN(detailsA, 107));
      // the playhead at 42.4s maps to the same fragment in the new level
      expect(snAtTime(detailsA, 42.4)).to.equal(107);
      expect(snAtTime(detailsB, 42.4)).to.equal(107);
    });

    it('keeps the playback position across multiple playlist refreshes', function () {
      const detailsA = levelA();
      let detailsB = levelB(102, 720);
      alignStream(detailsA, detailsB, logger);
      for (let refresh = 1; refresh <= 3; refresh++) {
        const nextDetails = levelB(102 + refresh, 720);
        mergeDetails(detailsB, nextDetails, logger);
        if (!nextDetails.alignedSliding && !nextDetails.fragmentStart) {
          alignStream(detailsB, nextDetails, logger);
        }
        detailsB = nextDetails;
        expect(detailsB.playlistParsingError).to.be.null;
        expect(startOfSN(detailsB, 107)).to.equal(42);
        expect(snAtTime(detailsB, 42.4)).to.equal(107);
      }
    });

    it('aligns on PDT when program date times of matching segments disagree by more than a second', function () {
      const detailsA = levelA();
      const detailsB = levelB(102, 2500);
      alignStream(detailsA, detailsB, logger);
      expect(startOfSN(detailsB, 102)).to.equal(14.5);
    });

    it('aligns renditions of another playlist type on PDT even when sequence numbers match', function () {
      const detailsA = levelA();
      const audioDetails = audioLevel(102, -500);
      alignStream(detailsA, audioDetails, logger);
      expect(startOfSN(audioDetails, 102)).to.equal(11.5);
    });
  });
});

function objToFragment(
  object: Partial<Fragment>,
  i: number = 0,
): MediaFragment {
  const fragment = new Fragment(PlaylistLevelType.MAIN, '') as MediaFragment;
  fragment.sn = i;
  for (const prop in object) {
    fragment[prop] = object[prop];
  }
  return fragment;
}

function objToLevelDetails(object: Partial<LevelDetails>): LevelDetails {
  const details = new LevelDetails('');
  for (const prop in object) {
    details[prop] = object[prop];
  }
  const fragCount = details.fragments.length;
  if (fragCount) {
    details.startCC = details.fragments[0].cc;
    details.endCC = details.fragments[fragCount - 1].cc;
  }
  details.totalduration = details.fragments.reduce(
    (acc, { duration }) => acc + duration,
    0,
  );
  return details;
}

function objToLevel(object: Partial<Level>): Level {
  const level = new Level({
    name: '',
    url: '',
    attrs: new AttrList({}),
    bitrate: 500000,
  });
  for (const prop in object) {
    level[prop] = object[prop];
  }
  return level;
}
