import type { SkillId } from '../types';

// Upper-Midwest mill-town names: Scandinavian, French-Canadian, Polish, Ojibwe-region, Irish.
export const FIRST_M = ['Gene', 'Arne', 'Dale', 'Lyle', 'Wes', 'Curtis', 'Marcel', 'Tom', 'Duane', 'Roy', 'Emmett', 'Joel', 'Kasimir', 'Luc', 'Darnell', 'Pete', 'Walt', 'Ray', 'Sully', 'Hank', 'Owen', 'Nils', 'Vince', 'Jerome', 'Cody', 'Elias', 'Ben', 'Mitch', 'Gabe', 'Leon'];
export const FIRST_F = ['Marla', 'Dolores', 'Ruth', 'Jen', 'Annika', 'Colette', 'Darlene', 'Bev', 'Tess', 'Ingrid', 'June', 'Rosalie', 'Kay', 'Nadine', 'Lorna', 'Sigrid', 'Mae', 'Hollis', 'Renee', 'Agnes', 'Shayna', 'Wren', 'Celia', 'Brigid', 'Ivy', 'Pauline', 'Dot', 'Lise', 'Carmen', 'Faye'];
export const LAST = ['Halvorsen', 'Doucette', 'Peltier', 'Engvall', 'Haugen', 'Kessler', 'Wick', 'Lindqvist', 'Nowak', 'Brandvold', 'Thibodeaux', 'Kowalczyk', 'Boucher', 'Sandberg', 'Moreau', 'Rasmussen', 'Dahl', 'Gauthier', 'Kaminski', 'Fairbanks', 'Ostrowski', 'Lacroix', 'Begay', 'Strand', 'Quist', 'Morrissey', 'Hale', 'Corbin', 'Larue', 'Vang'];
export const NICKS = ['Moose', 'Doc', 'Sarge', 'Tinker', 'Preacher', 'Skeeter', 'Red', 'Shorty', 'Bones', 'Lucky', 'Patch', 'Smoke', 'Hound', 'Birdie', 'Ace'];

export interface Backstory {
  text: string;
  skills: Partial<Record<SkillId, number>>;
  minAge?: number;
  maxAge?: number;
}

// Life before (adulthood)
export const BEFORE: Backstory[] = [
  { text: 'Ran the number 3 paper machine at the Aubin for twenty-two years, until they cut the second shift.', skills: { crafting: 3, building: 2 }, minAge: 38 },
  { text: 'Night nurse at St. Aubin Manor. Was there the week the residents stopped being residents.', skills: { medicine: 4, social: 1 } },
  { text: 'Drove the Vessey cable ferry for the Halvorsen family. Knows the river\'s moods.', skills: { scavenging: 2, building: 1 } },
  { text: 'County deputy, eleven years. Signed the Exposure Register more times than they can say.', skills: { shooting: 4, social: 1 } },
  { text: 'Cooked the breakfast line at the Ferry Diner. Knows everybody\'s order and everybody\'s business.', skills: { farming: 2, social: 2 } },
  { text: 'Taught chemistry at Vessey High. Sat in on the DNR meeting about Pond 2.', skills: { medicine: 2, crafting: 2 } },
  { text: 'Deer hunter and taxidermist on Route 9. Shot a doe in October that did not run.', skills: { shooting: 3, scavenging: 2 } },
  { text: 'Millwright. Kept the boilers and the steam lines alive with bad parts and worse budgets.', skills: { crafting: 3, building: 3 }, minAge: 30 },
  { text: 'Ran a hobby farm out past the Corliss road. Lost the herd to "wasting" in September.', skills: { farming: 4, building: 1 } },
  { text: 'Union steward for Local 41. Talks people down from things.', skills: { social: 4, building: 1 }, minAge: 35 },
  { text: 'Pharmacy tech at the Rexall. Knows exactly what is left and where.', skills: { medicine: 3, scavenging: 1 } },
  { text: 'Lineman for the power co-op. Climbed poles in ice storms for a living.', skills: { building: 3, crafting: 2 } },
  { text: 'Two tours overseas, then the VA and the bowling alley. Does not talk about either.', skills: { shooting: 5 }, minAge: 28 },
  { text: 'Grad student home for the semester, writing a thesis nobody will read now.', skills: { social: 1, medicine: 1, crafting: 1 }, maxAge: 32 },
  { text: 'Scrapper. Pulled copper out of the closed plants in Corliss for cash.', skills: { scavenging: 4, crafting: 1 } },
  { text: 'Lutheran deaconess. Kept the parish registry and the food pantry books.', skills: { social: 3, farming: 1 } },
  { text: 'Long-haul trucker, home between runs when they put up the Line.', skills: { scavenging: 2, crafting: 1, shooting: 1 } },
  { text: 'Bartender at the Legion hall. Has heard every confession in Vessey.', skills: { social: 3, shooting: 1 } },
  { text: 'High school wrestling coach and gym teacher.', skills: { building: 2, social: 2 } },
  { text: 'Volunteer firefighter and part-time roofer.', skills: { building: 3, medicine: 1 } },
  { text: 'Unemployed since the mill layoffs. Did odd jobs, sold firewood, drank.', skills: { scavenging: 2, building: 1 } },
  { text: 'Game warden for the DNR. Was on the sampling team that went out to the ponds.', skills: { shooting: 2, scavenging: 2, medicine: 1 } },
];

// What they did when it began
export const OUTBREAK: string[] = [
  'Was at the homecoming game when the groundskeeper went for the bleachers.',
  'Spent the first week in the Lutheran church shelter. Left before All Saints\'. Will not say how.',
  'Tried to cross at Corliss. Turned back by the Guard with a rifle in their face.',
  'Waited three days by the phone for a call from their daughter in Duluth.',
  'Rode the last night ferry to Grace Island and came back alone.',
  'Hid in the walk-in cooler at the Ferry Diner for two days.',
  'Put down their own father in the kitchen. Washed the floor afterward.',
  'Worked the Parish soup line until the gym got too crowded to be safe.',
  'Walked out of the courthouse holding cells when the deputies stopped coming.',
  'Spent a week alone in a deer stand, rationing jerky and listening to the radio loop.',
  'Drove the school bus on the evacuation that never reached the bridge.',
  'Followed the mill sirens to Local 41 and was turned away at the gate for not being union.',
  'Buried their spouse in the backyard under the swing set.',
  'Looted the Rexall with three strangers. Only two came back out.',
  'Heard the All Saints\' bell ring for forty minutes and walked toward it, then thought better.',
];

export const SKILL_NAMES: Record<SkillId, string> = {
  shooting: 'Shooting', building: 'Building', crafting: 'Crafting', medicine: 'Medicine', scavenging: 'Scavenging', farming: 'Farming', social: 'Social',
};
