// Found documents. Fragments, many voices, nothing confirmed.
export interface Doc { id: string; title: string; text: string }

export const DOCS: Doc[] = [
  { id: 'eas', title: 'EAS broadcast (loop, AM 1340)', text: 'This is an emergency message for Aubin County. Remain indoors. Do not approach individuals displaying confusion or fever. Await instructions. This is an emergency message for Aubin County. Remain—' },
  { id: 'shiftlog', title: 'Mill shift log, Oct 3 (pencil)', text: 'Pond 2 foaming again, orange, smells like bread gone off. Told Kessler. Kessler says don\'t log it. Logging it.' },
  { id: 'license', title: 'Hunting licence, back side', text: 'Doe at 40 yds, didn\'t run. Looked right at me. Didn\'t shoot. Something wrong with her eyes. Went home. Told Jen I got nothing.' },
  { id: 'registry', title: 'Parish registry card', text: 'NAME: Arnold P. Haugen. AGE: 81. STATUS: Missing. Turned. [both struck through] Came home Thursday. Sitting in his chair. Leave him be. — R.E.' },
  { id: 'diner', title: 'Ferry Diner whiteboard (photographed)', text: 'SPECIAL: SOUP (whatever\'s left). FERRY: CLOSED BY ORDER. Ferry anyway 2am ask Doucette. PIE: no. Pray for Marla.' },
  { id: 'exposure', title: 'County "Exposure Register", p. 14', text: 'Wick, Thomas — bite, L forearm — 10/27 — remanded to holding. 10/28 — remanded. 10/29 — [entry struck through] — disposition: per Sgt. Hale.' },
  { id: 'local41', title: 'Local 41 notice, stapled to the mill gate', text: 'EVERYBODY WORKS A SHIFT. Kids work the laundry. Old timers watch the boiler. Nobody eats who don\'t. Nobody gets left who does. — D. Wick, Steward' },
  { id: 'tape', title: 'Answering machine tape, Birch St.', text: 'Hi, it\'s Mom. The school\'s sending everyone to the gym. I\'ll leave the porch light on for you. I\'ll leave it on, honey.' },
  { id: 'dnr', title: 'DNR field sample sheet (photocopy)', text: 'Site: NAP Pond 2. Visual: orange flocculent mats. Odor: sweet/fermented. Organism ID: [REDACTED — forward to state lab]. Recommend: ███████. Sampler hospitalized 9/24.' },
  { id: 'worksheet', title: 'School worksheet, "My Town" (crayon)', text: 'My dad works at the mill. My mom drives the ferry. When I grow up I want to drive the ferry. The river is brown because of trees not because of dirt.' },
  { id: 'pinned', title: 'Note pinned to a Turned man\'s coat', text: 'This is Danny Peltier. He was a good dog-sled racer and he owes me twenty bucks. Please do it quick. — his brother.' },
  { id: 'memo', title: 'Northern Aubin Paper Co. internal memo, 2018', text: 'RE: Process change, Line 2 effluent. Per consultant recommendation the new enzymatic pre-treatment will reduce settling pond volume by 40%. Biological activity in Ponds 1–3 to be monitored quarterly. Do not circulate outside management.' },
  { id: 'roster', title: 'National Guard duty roster (water-stained)', text: '1st Bn, 128th — ACTIVATION: Aubin Co. containment, Corliss Bridge. Report NLT 0600. Dated: 18 OCT. [Two days before the homecoming game.]' },
  { id: 'sermon', title: 'Sermon notes, Trinity Lutheran (unfinished)', text: 'All Saints. The bell. Who rang it? I have asked everyone. Every soul in the shelter says they were asleep. Forty minutes. I counted. I am not going to preach on judgment. I am not. I am going to preach on' },
  { id: 'deercamp', title: 'Deer camp logbook, Route 9', text: 'Nov 2. Nils went down to check the freezer. Says the deer by the salt lick don\'t eat anymore, just stand there facing town. Like they\'re waiting for something. Nov 3. Nils didn\'t come back up.' },
  { id: 'ferrylog', title: 'Ferry crossing log, Doucette hand', text: '11/1 0210 — 6 pax east. 11/1 0340 — 2 pax west, one coughing, told her no, she paid anyway. 11/2 — lights on Grace Island. Not ours. 11/3 — no crossing. Something in the water at the landing.' },
  { id: 'nurse', title: 'St. Aubin Manor shift note', text: 'Mrs. Lindqvist (Rm 12) asked again for her husband. Told her he\'s coming Sunday. He died in 2009. She bit Carol at 0300. I don\'t know what to write here. They don\'t have a form for this.' },
  { id: 'quiet', title: 'Pamphlet, hand-lettered on mill bond paper', text: 'THEY ARE NOT DEAD. THEY ARE LISTENING. The river carried it to us so that we would stop. Stop shooting. Stop running. Come to the ponds and be quiet with us. — the Quiet' },
  { id: 'kid', title: 'Note in a child\'s backpack', text: 'Mom if you find this we went to the Legion. Mr. Strand has a truck. Dont come in the back way the back way has them. I fed Biscuit. Love Amy.' },
  { id: 'coroner', title: 'County coroner, handwritten addendum', text: 'Subject #31. No respiration, no pulse, pupillary response present. Core temperature 19°C. Continues to orient toward the window. Toward the river. Recommend we stop calling them deceased.' },
  { id: 'ice', title: 'Ice-out calendar, Halvorsen boathouse wall', text: 'Freeze-up: \'19 Nov 30. \'20 Dec 4. \'21 Nov 26. \'22 Nov 29. \'23 Dec 1. This year: [circled] NOV 28?? — get the boats out. get everything out.' },
  { id: 'letter', title: 'Unsent letter, Legion hall bar', text: 'Rob — they say the Line will open when the town shows "containment." I think containment means us. I think it always meant us. If you get this, don\'t come. I mean it. Don\'t come back to Vessey.' },
];

export interface Faction { id: string; name: string; desc: string }
export const FACTIONS: Faction[] = [
  { id: 'union', name: 'Local 41', desc: 'The Papermakers\' union holding the mill compound: steam, steel, and hard rules. Steward Dolores Wick. They know more about Pond 2 than they say.' },
  { id: 'parish', name: 'The Parish', desc: 'Our Lady and Trinity Lutheran together, feeding whoever comes. Pastor Ruth Engvall. They will not kill the Turned who come home.' },
  { id: 'ferry', name: 'The Ferry families', desc: 'Halvorsen, Doucette, Peltier. They run the night crossings and trade with anyone breathing. Their power ends with the ice.' },
  { id: 'county', name: 'The County', desc: 'The sheriff\'s remnant and three Guardsmen at the courthouse. Lists, quarantine, the Exposure Register. They believe the Line will reopen.' },
];
