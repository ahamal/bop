// The music library manifest. Tracks live in public/music/ (Pixabay, filename
// convention artist-title-id.mp3); title/artist/mood are curated here by hand.
// Mood is a name-based guess for now — "upbeat" drives the default game
// playlist, "calm" is reserved for rest/cooldown states later.

export type Mood = "upbeat" | "calm";

export interface Track {
  file: string;
  title: string;
  artist: string;
  mood: Mood;
}

const t = (file: string, title: string, artist: string, mood: Mood): Track => ({
  file: `music/${file}`,
  title,
  artist,
  mood,
});

export const TRACKS: readonly Track[] = [
  // — upbeat —
  t("penguinmusic-better-day-186374.mp3", "Better Day", "penguinmusic", "upbeat"),
  t("penguinmusic-gardens-stylish-chill-303261.mp3", "Gardens", "penguinmusic", "upbeat"),
  t("folk_acoustic-summer-walk-152722.mp3", "Summer Walk", "Folk Acoustic", "upbeat"),
  t("alexgrohl-sad-soul-hip-hop-185750.mp3", "Sad Soul", "AlexGrohl", "upbeat"),
  t("rockot-eona-emotional-ambient-pop-351436.mp3", "Eona", "Rockot", "upbeat"),
  t("good_b_music-perfect-beauty-191271.mp3", "Perfect Beauty", "Good B Music", "upbeat"),
  t("sergepavkinmusic-a-long-way-166385.mp3", "A Long Way", "Serge Pavkin", "upbeat"),
  t("sonican-background-music-new-age-nature-465069.mp3", "New Age Nature", "Sonican", "upbeat"),
  // — calm —
  t("leberch-relax-509408.mp3", "Relax", "Leberch", "calm"),
  t("mickeyscat-moment-of-peace-mickeyscat-554494.mp3", "Moment of Peace", "MickeysCat", "calm"),
  t("morgan-ambient-calm-ambient-dreamscape-529861.mp3", "Calm Dreamscape", "Morgan", "calm"),
  t("music_for_video-just-relax-11157.mp3", "Just Relax", "Music for Video", "calm"),
  t("the_mountain-relax-508021.mp3", "Relax", "The Mountain", "calm"),
];
