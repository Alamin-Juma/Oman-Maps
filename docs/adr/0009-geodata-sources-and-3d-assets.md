# 0009. Geodata sources, licences and how 3D assets are produced and stored

- **Status:** Accepted (founder, 2026-11-16, Phase 0 checkpoint of `docs/briefs/3d-explorer.md`), with these decisions:
  rivers are traced on the Copernicus DEM guided by Natural Earth (option B); OpenStreetMap (option C) is the
  pre-approved fallback; HydroRIVERS is not used; generated assets are committed through Git LFS.
  Section "What Phase 1 built" records how the approved design was carried out.
- **Date:** 2026-11-16
- **Licences checked on:** 2026-11-16, each at its official source (links below). This is an engineer's reading of
  the licence texts, not legal advice. Before commercial launch, have a lawyer confirm the table.

## Context
The 3D Explorer (ADR-0008) needs real terrain, real rivers and real land colour. Geography shown to children must be
accurate and reviewable, so it comes from data, never from AI image generation. DuniaLab is a **commercial** product
with strict child-data rules: *"Collect only: parent account, child nickname + grade + picture PIN, learning events."*
New grades must be content drops (ADR-0004).

## Decision

### 1. A generator tool turns packs plus open data into committed assets
- **`tools/geo`** (`@dunialab/geo`), a Node/TypeScript command-line tool. It does file and network I/O, so it lives
  outside `packages/*`, which stay pure.
- **Input:** every pack in `packages/content/packs/*.json` (`printTarget.bounds`, `features`). It never names a pack.
- **Raw downloads** are cached in `.cache/geo/` (gitignored) and never committed.
- **Output:** `content-assets/<packId>/3d/`, committed with Git LFS, with a `manifest.json` holding source dataset
  versions, licences, parameters, a SHA-256 per file, and review flags (for example border depiction).
- **Why commit outputs instead of generating in CI:** teachers approve the exact assets that ship; builds work
  offline and reproducibly; CI never downloads gigabytes. CI checks the manifest (hashes and budgets) instead.

### 2. Sources and verified licences

| Data | Use | Licence (verified) | Commercial use | What we must do |
|---|---|---|---|---|
| **Copernicus DEM GLO-30 / GLO-90** | Elevation | Copernicus DEM licence ("Full, Free & Open") | Allowed: rights are granted without a purpose restriction | Show two notices; add one liability sentence to our terms; do not imply endorsement |
| **ESA WorldCover 10 m** (2020 v100 / 2021 v200) | Land-cover colour | CC BY 4.0 | Allowed | Show the attribution text |
| **Natural Earth** (already used through `world-atlas`) | Borders, coastline, river guide lines | Public domain | Allowed | Nothing (credit is optional; we will credit) |
| **GEBCO grid** (optional) | Ocean depth | Public domain with conditions of use | Allowed | Acknowledge the source; do not imply endorsement |
| **HydroRIVERS (HydroSHEDS v1)** | River network | HydroSHEDS v1 licence agreement (WWF) | Allowed, **but with heavy conditions** | See section 3. **Recommended: do not use.** |
| **OpenStreetMap** (fallback for rivers) | River lines | ODbL 1.0 | Allowed | Attribution, and share our extracted river data under ODbL |

**Exact terms quoted from the sources**

*Copernicus DEM GLO-30* — "Licence for Copernicus DEM instance COP-DEM-GLO-30-F Global 30m Full, Free & Open"
([licence document](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf),
[Copernicus Data Space page](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM),
[AWS bucket readme](https://copernicus-dem-30m.s3.amazonaws.com/readme.html)):
> "Article 4. Right of Use. The Licensor grants to the User the following non-exclusive rights of use regarding the
> Copernicus WorldDEM-30: (a) reproduction; (b) distribution; (c) communication to the General Public;
> (d) adaptation, modification and combination with other data and information."
>
> "Article 5. Financial Conditions. The use rights granted under this licence are free of charge to the User."
>
> "The rights granted under this Licence are worldwide and without limitation in time."

Obligations (Article 6), which we must implement:
> (a) "... the User shall inform the General Public of the source by using the following notice: © DLR e.V. 2010-2014
> and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights
> reserved."
>
> (b) "Where the Copernicus WorldDEM-30 data have been adapted or modified, the User shall provide the following
> notice: 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018
> provided under COPERNICUS by the European Union and ESA; all rights reserved'."
>
> (c) "The following sentence or its translation in any language shall be added by such Users in a licence or any
> legal warning or notice covering their distribution or communication to the General Public of the Copernicus
> WorldDEM-30: 'The organisations in charge of the Copernicus programme by law or by delegation do not incur any
> liability for any use of the Copernicus WorldDEM-30'."

The **GLO-90** licence ("Licence for COP-DEM-GLO-90-F Global 90m Full, Free & Open", same document) grants the same
four rights free of charge with the same obligations, naming "WorldDEM-90". The licence never uses the word
"commercial"; it grants the rights without limiting the purpose, and Copernicus states *"The GLO-30 and GLO-90
datasets are available worldwide with a free license."* We read that as permitting commercial use.

*ESA WorldCover* ([data access page](https://esa-worldcover.org/en/data-access)):
> "The ESA WorldCover product is provided free of charge, without restriction of use. For the full license
> information see the Creative Commons Attribution 4.0 International License."
>
> "If you are using the data as a layer in a published map, please include the following attribution text:
> © ESA WorldCover project [year] / Contains modified Copernicus Sentinel data ([year]) processed by ESA WorldCover
> consortium"

*Natural Earth* ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/)):
> "All versions of Natural Earth raster + vector map data found on this website are in the public domain. You may use
> the maps in any manner, including modifying the content and design, electronic dissemination, and offset printing.
> ... invites you to use them for personal, educational, and commercial purposes. No permission is needed to use
> Natural Earth. Crediting the authors is unnecessary."

*GEBCO* ([terms of use](https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use)):
> "The GEBCO Grid is placed in the public domain and may be used free of charge. ... Users are free to: Copy, publish,
> distribute and transmit The GEBCO Grid. Adapt The GEBCO Grid. Commercially exploit The GEBCO Grid, by, for example,
> combining it with other information, or by including it in their own product or application. Users must:
> Acknowledge the source of The GEBCO Grid. ... Not use The GEBCO Grid in a way that suggests any official status or
> that GEBCO, or the IHO or IOC, endorses any particular application of The GEBCO Grid."

*OpenStreetMap* ([copyright page](https://www.openstreetmap.org/copyright)):
> "OpenStreetMap is open data, licensed under the Open Data Commons Open Database License (ODbL) ... You are free to
> copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If you
> alter or build upon our data, you may distribute the result only under the same license."

### 3. HydroRIVERS: commercial use is allowed, but the conditions do not fit us
The brief planned to trace rivers through HydroRIVERS. Its page says
([HydroRIVERS](https://www.hydrosheds.org/products/hydrorivers)):
> "The HydroRIVERS database is freely available for scientific, educational and commercial use. The data are
> distributed under the same license agreement as the HydroSHEDS core products ..."

The agreement itself ([HydroSHEDS Technical Documentation v1.4, Appendix A](https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf))
adds conditions:

| Clause | Text | Problem for DuniaLab |
|---|---|---|
| 2.1.2 | "... distribute the Licensed Materials incorporated into any Derivative Works to End Users, subject to the terms and conditions of an end user license agreement with terms that are at least as protective of the Licensed Materials as are the terms of this License" | Every parent would have to accept a licence agreement written to protect WWF's data. |
| 10.7 | "Licensee agrees to maintain complete, clear and accurate records ... including, without limitation, its sales of the Licensed Materials integrated with any Derivative Works and **the identity and address of each End User** ... Licensee shall permit WWF or persons designated by WWF to inspect records" | Conflicts directly with our rule to collect only a parent account, nickname, grade and PIN. We do not and must not hold addresses. |
| 7.1 | "This License ... will terminate (i) automatically upon any breach by Licensee ...; or (ii) in the sole discretion of WWF." | A supplier could withdraw the rivers from a shipped product at any time. |
| 8.1 | "The Licensee shall not issue any press release or any other publicity regarding this License ... without WWF's express written approval." | Minor, but a constraint. |
| Exhibit B | A long mandatory copyright statement naming WWF and seven other rights holders. | Workable, but heavy. |

**Decision (approved 2026-11-16): do not use HydroRIVERS.** Options that were considered instead:

| Option | How | Licence burden | Risk |
|---|---|---|---|
| **B. Trace rivers ourselves on the Copernicus DEM** (**chosen**) | From the source end of the pack's rough `path`, route water downhill over the elevation data (fill pits, follow steepest descent) until the sea or a lake. Use Natural Earth's 10 m river centre lines (public domain) as a guide corridor and as a cross-check. | None beyond Copernicus (already accepted) and Natural Earth (public domain). | Accuracy in very flat land (the lower Tana and its delta). Mitigated by the guide line and by the founder's preview checkpoint in Phase 1. More algorithm work in Phase 1. |
| **C. OpenStreetMap waterways** (**pre-approved fallback**: if option B gets a river visibly wrong, switch for that river, record why here and add the ODbL credit; no need to ask first) | Extract the river from OSM and order it from source to mouth. | Attribution, plus share-alike: our extracted river lines must be offered under ODbL. Acceptable (they are plain geography), but a standing duty. | Extraction tooling; OSM tagging quality varies by river. |
| A. HydroRIVERS | As the brief planned. | Section 3 above. | Not recommended. |

With option B the river's on-screen width comes from the upstream drainage area we compute while routing, in place of
HydroRIVERS' discharge attribute. Whether Natural Earth's 10 m rivers include every river a pack needs is confirmed
in Phase 1 (no data was downloaded for that in Phase 0).

### 4. Attribution and notices (applies to web, the printed map and the Unity app)
- An **"About this map"** panel and `content-assets/ATTRIBUTION.md` carry: the two Copernicus notices, the WorldCover
  attribution, "Made with Natural Earth", the GEBCO acknowledgement if used, and the OSM credit if option C is used.
- Our terms of use gain the Copernicus sentence from Article 6(c).
- Nothing may suggest that ESA, the EU, Copernicus, GEBCO or OSM endorse DuniaLab.
- `manifest.json` records, per file, which sources it was derived from, so the notice list is generated, not remembered.

### 5. What we never use
Non-commercial ("NC") data, including the newer Sentinel-2 "cloudless" mosaics; any third-party tile or terrain
service at runtime; AI-generated geography.

## What the Phase 0 spike measured (`tools/geo/spikes/cog-window.mjs`)
One 40 km window around the Mount Kenya anchor, read from the GLO-30 Cloud-Optimised GeoTIFF on the public AWS
bucket with HTTP range requests, from Node 22 on Windows, 2026-11-16:

| Measure | Value |
|---|---|
| File | `Copernicus_DSM_COG_10_S01_00_E037_00_DEM.tif`: 40.2 MB, 3600 x 3600 pixels, about 30.7 m per pixel, 32-bit float, deflate |
| Internal layout | 1024 x 1024 tiles; overviews 1800, 900 and 450 pixels wide |
| Window read | 1294 x 1199 pixels (1.55 million samples) |
| Network | 13 range requests, **9.62 MB**, 23.9% of the file (header: 5 kB) |
| Time | 48 s on the founder's connection (about 200 kB/s) |
| Elevation | 1,932 m to **5,159 m**, highest point at 37.309 E, 0.153 S (the summit; the approved fact says "about 5,199 m") |

What this tells Phase 1:
1. **Range reads work** on Windows with `geotiff` 3.0.5. No account, no GDAL install.
2. **A window costs whole internal tiles.** A 40 km window touched 4 of the file's 16 internal tiles, so it cost a
   quarter of the file. Budget roughly 10 MB of download per HD patch per source file.
3. **Patches cross file borders.** The window was cut at the equator: Mount Kenya's patch needs the file to the north
   as well. The generator must mosaic neighbouring files.
4. **Use the built-in overviews** for the country and regional levels. They avoid downloading about 99 files at
   full detail (about 4 GB).
5. **The network drops connections.** The first run failed with `ECONNRESET`; the generator needs retries with
   backoff and a resumable cache.
6. **The data peaks 40 m under the true summit** (30 m sampling smooths sharp peaks). This is why on-screen heights
   come from the pack's approved facts, never from the data.
7. Expect a first full generation for the Kenya pack to download a few hundred MB and take tens of minutes on this
   connection. It runs once; results are cached.

## What Phase 1 built (recorded 21 November 2026)

- **Generator:** `tools/geo` (`npm run geo:build`, `geo:verify`, `unity`). Rivers are traced with option B:
  flood upward from the sea or lake, inside a corridor around the Natural Earth line, with gaps in the
  surveyed line bridged.
- **Kenya Explorer assets:**
  - the Tana traced **751 km** from the pack's start point to the Indian Ocean, never more than 17.5 km from
    the surveyed line (**758.9 km** after the generator fixes of 22 November 2026, findings register CR59-CR61:
    short steps now measured from the last point kept, and the water level filled from the mouth upward). Natural Earth's surveyed line over the same stretch is about 704 km, and about 760 km
    for the whole river at its level of detail. The often-quoted ~1,000 km is the whole river in full detail
    and is not comparable;
  - Lake Turkana at 362 m and Lake Victoria at 1,133 m;
  - HD patches made from the 30 m data;
  - 17.36 MB shipped against 25 MB, and 0.50 MB to open 3D for the first time.
- **Storage:** images in Git LFS (20.2 MB). CI verifies sizes and fingerprints from the LFS pointers.
- **Tests:** `tests/features/geo/kenya-3d-assets.feature.test.ts` compares the traced length with the surveyed
  line, using the committed public-domain fixture `tests/features/fixtures/natural-earth-tana.geojson`.

## Consequences
- New top-level folders: `tools/geo` (now, spike only) and `content-assets/` (Phase 1). `.cache/` is gitignored.
- Git LFS holds the images under `content-assets/**` (`*.webp`, `*.jpg`); JSON and Markdown stay ordinary text so they
  can be reviewed in diffs. Total LFS above 50 MB needs the founder's approval first; `npm run geo:build` prints the
  total and says STOP when it is exceeded.
- **CI does not download the images on every run.** `actions/checkout` leaves Git LFS files as small pointer files,
  and a pointer records the real file's size and SHA-256. `verifyAssets` reads those, so the main workflow still
  checks every file's size and fingerprint against the manifest, and all data budgets, at no LFS bandwidth cost.
  Scenarios that need real pixels (mountain heights, lake flatness in the terrain) are skipped there and run in a
  second workflow, `.github/workflows/content-assets.yml`, which checks out with `lfs: true` **only when
  `content-assets/**`, `tools/geo/**` or a pack changes**.
- Phase 1 includes a river-routing algorithm (option B) with fixtures: a synthetic terrain with a known river,
  pits to fill, and a flat delta.
- The brief's section 4.2 step 5 now describes option B.
- Sensitive content stays under teacher review: borders (the Ilemi Triangle is disputed) use the same Natural Earth
  source as the 2D basemap and are flagged in the manifest.
- Diagrams changed: components (generator, planned asset store, external data sources) and change log in
  `docs/architecture/README.md`.
