/**
 * Ledger UI icons: each id has a picture at public/sprites/icon_<id>.png (80px tall, generated
 * from tools/sprites-ui-icons.json). Pass an id to `ico()` from ./kit.
 * skill_<SkillId>, job_<JobId>, and st_* status/stat markers.
 */
export const UI_ICONS = [
  'skill_shooting', 'skill_building', 'skill_medicine',
  'skill_scavenging', 'skill_social',
  'job_guard', 'job_repair', 'job_scavenge', 'job_craft', 'job_farm', 'job_doctor',
  'job_rest', 'job_radio', 'job_cook', 'job_drill', 'job_counsel',
  'st_wound', 'st_bite', 'st_sick', 'st_tired', 'st_hungry', 'st_cold',
  'st_break', 'st_courage', 'st_grit', 'st_mood_up', 'st_mood_down', 'st_love',
  'st_hate', 'st_dead', 'st_perk', 'st_xp', 'st_danger', 'st_noise',
  'st_time', 'st_wall', 'st_radio', 'st_faction', 'st_trait',
] as const;
export type UiIcon = (typeof UI_ICONS)[number];
