// shared/hashtags.ts

export const hashtags = {
  soulReading: [
    '#soulblueprint',
    '#energyreading',
    '#birthchartdecoded',
    '#spiritualpath',
    '#messyandmagnetic',
  ],
  homestead: [
    '#homesteadinglife',
    '#offgridliving',
    '#coyotecommons',
    '#landbasedhealing',
    '#messyandmagnetic',
  ],
  motherhood: [
    '#gentleparenting',
    '#momsoftiktok',
    '#chaosandcalm',
    '#healinggenerations',
    '#messyandmagnetic',
  ],
  rhythmSystem: [
    '#soulschedule',
    '#familyrhythm',
    '#magnetboard',
    '#ritualroutines',
    '#messyandmagnetic',
  ],
  retreat: [
    '#spiritualretreat',
    '#coyotecommons',
    '#earthhealing',
    '#intentionalcommunity',
    '#messyandmagnetic',
  ],
  trending: [
    '#fyp',
    '#tiktokmademebuyit',
    '#momtok',
    '#healingtok',
    '#spiritualtok',
  ],
};

export function getHashtags(theme: keyof typeof hashtags = 'soulReading') {
  const pool = hashtags[theme] || hashtags.trending;
  return pool.slice(0, 5).join(' ');
}