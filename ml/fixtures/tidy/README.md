# Synthetic tidy tables

Output of `python -m lakerecs tidy --fixtures fixtures/raw --out fixtures/tidy` (run from `ml/`). All lakes and numbers are **synthetic** ("Fixture Lake …", fake ids, random numbers); see `../README.md`. For tests and model development only. Never publish them as data.

Schema: `lakerecs/schema.py`. Load with `lakerecs.schema.read_tidy("fixtures/tidy")`.
