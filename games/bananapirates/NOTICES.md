# Dictionary Notices

Banana Pirates' word lists are derived from the following cleanly-licensed
sources. No copyrighted Scrabble lists (NWL/TWL/CSW) are included.

| Source | License |
|---|---|
| [ENABLE](https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt) | Public domain |
| [YAWL](https://raw.githubusercontent.com/elasticdog/yawl/master/yawl-0.3.2.03/word.list) | Public domain |
| [Norvig count_1w](https://norvig.com/ngrams/count_1w.txt) | MIT |
| [AGID inflections](https://raw.githubusercontent.com/en-wl/wordlist/master/agid/infl.txt) | Public domain (Kevin Atkinson) |

- **ENABLE** is public domain (the de-facto free Scrabble word list).
- **YAWL** is public domain (Mendel Cooper, via elasticdog/yawl).
- **Norvig count_1w** word-frequency data is MIT-licensed (Peter Norvig).

The permissive list (human validation) is the union of ENABLE and YAWL.
The restrictive list (CPU play) is ENABLE intersected with a frequency floor
so the bot only plays words people readily recognize.
