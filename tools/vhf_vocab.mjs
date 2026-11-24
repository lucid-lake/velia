// The VHF forecast's vocabulary as JSON (src/vhf/forecast.js VOCAB), for tools/vhf_voice.py:
//   node tools/vhf_vocab.mjs > renders/vhf/vocab.json
import { VOCAB } from '../src/vhf/forecast.js';
import { HM_VOCAB } from '../src/vhf/harbourMaster.js';   // the harbour master's calls
import { RACE_VOCAB } from '../src/sim/race/officer.js';        // the race officer's and Wren's calls
process.stdout.write(JSON.stringify({ ...VOCAB, ...HM_VOCAB, ...RACE_VOCAB }, null, 1) + '\n');
