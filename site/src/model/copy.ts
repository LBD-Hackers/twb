/**
 * Every word on the data model page (`/datamodel/`, `/en/datamodel/`), Danish and English. The
 * counts are not written here: they come from the captured ontology (`graph.ts`) and from the
 * engine's own results, and are put into the text where it is rendered.
 */

import type { Text } from '../copy';

const t = (da: string, en: string): Text => ({ da, en });

export const modelCopy = {
    meta: {
        title: t(
            'Datamodellen — Thin-walled blueprints',
            'The data model — Thin-walled blueprints'
        ),
        description: t(
            'TWB-ontologien forklaret: et hus som tynde flader, kanter og zoner, med opskrifter, samlinger og krav der hvor de hører til. Et interaktivt skema, eksempler i den åbne viewer og regeltjek, der kører i din browser.',
            'The TWB ontology explained: a house as thin surfaces, edges and zones, with recipes, joints and requirements where they belong. An interactive schema, examples in the open viewer, and rule checks that run in your browser.'
        ),
    },
    nav: {
        datamodel: t('Datamodellen', 'Data model'),
        concepts: t('Begreberne', 'Concepts'),
        wallLine: t('Væglinjen', 'Wall line'),
        modules: t('Modulerne', 'Modules'),
        schema: t('Skemaet', 'Schema'),
        examples: t('Eksempler', 'Examples'),
        checks: t('Regeltjek', 'Rule checks'),
        open: t('Åbent', 'Open'),
        back: t('Til forsiden', 'Back to the start'),
    },
    hero: {
        kicker: t('Datamodellen · TWB-ontologien', 'The data model · the TWB ontology'),
        title: t('Et hus er flader,\nkanter og zoner.', 'A house is surfaces,\nedges and zones.'),
        lead: t(
            'Under værktøjet ligger en åben datamodel: TWB, en OWL-ontologi oven på Building Topology Ontology (BOT). Den beskriver huset, før det er detaljeret — tynde flader på konstruktionens referenceplaner — og hæfter byggeviden på der, hvor den hører til: en opskrift på fladen, en samling på kanten, et krav på den side, der vender mod rummet.',
            'TWB is an open data model: an OWL ontology on top of the Building Topology Ontology (BOT). It describes the house before it is detailed — thin surfaces on the structure’s reference planes — and attaches construction knowledge where it belongs: a recipe on the surface, a joint on the edge, a requirement on the side that faces the room.'
        ),
        stats: {
            classes: t('klasser', 'classes'),
            objectProperties: t('relationer', 'object properties'),
            datatypeProperties: t('egenskaber', 'datatype properties'),
            licence: t('licens for ontologien', 'licence of the ontology'),
        },
        downloads: t('Hent hele ontologien', 'Download the whole ontology'),
        shapes: t('SHACL-reglerne', 'The SHACL shapes'),
        context: t('JSON-LD-konteksten', 'The JSON-LD context'),
    },
    concepts: {
        kicker: t('01 · Begreberne', '01 · The concepts'),
        title: t('Viden der, hvor den hører til', 'Knowledge where it belongs'),
        lead: t(
            'En væg i TWB er ikke et objekt med en tykkelse. Den er en flade uden tykkelse, og alt det, man ved om væggen, sidder på fladen, dens sider, dens kanter eller dens åbninger. Fem steder bærer modellen.',
            'A wall in TWB is not an object with a thickness. It is a surface with none, and everything known about the wall sits on the surface, its sides, its edges or its openings. Five places carry the model.'
        ),
        items: [
            {
                term: 'twb:Surface',
                title: t('Fladen bærer en opskrift', 'The surface carries a recipe'),
                body: t(
                    'En plan polygon på væggens, gulvets eller tagets referenceplan — i et træskelet stolpernes centerlinje. Opskriften (twb:Recipe) er lagene i rækkefølge, et af dem kernen. Fladen er et bot:Element i sin tynde form; de afledte reglar er dens underelementer.',
                    'A planar polygon on the reference plane of a wall, floor or roof — in a timber frame, the centreline of the studs. The recipe (twb:Recipe) is the layers in order, one of them the core. The surface is a bot:Element in its thin form; the derived members are its sub-elements.'
                ),
                terms: ['twb:Surface', 'twb:Recipe', 'twb:Layer'],
            },
            {
                term: 'twb:ZoneBoundary',
                title: t('Siden bærer kravene', 'The side carries the requirements'),
                body: t(
                    'Hver flade har to sider (twb:SurfaceSide), og hver side vender mod zoner. Hvor en zone møder en side, er der en zonegrænse — og det er dér, kravene lander: vådrumssikring mod badet, maling mod soveværelset. Kun den del af væggen, badet vender mod.',
                    'Every surface has two sides (twb:SurfaceSide), and each side faces zones. Where a zone meets a side there is a zone boundary — and that is where requirements land: a wet-room lining towards the bath, paint towards the bedroom. Only the part of the wall the bath faces.'
                ),
                terms: ['twb:SurfaceSide', 'twb:ZoneBoundary', 'twb:Room'],
            },
            {
                term: 'twb:Edge',
                title: t('Kanten bærer samlingen', 'The edge carries the joint'),
                body: t(
                    'Hvor to flader mødes, er der en kant (et bot:Interface) med en type: hjørne, tagfod, gavl, T-samling. Samlingen (twb:JointDetail) siger, hvordan hvert lag i hver flade ender. Den mest specifikke vinder: kantens egen, så skabelonen, så projektets standard, ellers geringen.',
                    'Where two surfaces meet there is an edge (a bot:Interface) with a type: corner, eave, verge, T-junction. The joint (twb:JointDetail) says how every layer of every surface ends. The most specific wins: the edge’s own, then the template, then the project standard, else a mitre.'
                ),
                terms: ['twb:Edge', 'twb:JointDetail', 'twb:JointTemplate'],
            },
            {
                term: 'twb:Opening',
                title: t('Åbningen bærer sin inddækning', 'The opening carries its finish'),
                body: t(
                    'Vinduer og døre er åbninger, som fladen hoster (bot:hostsElement). Hver har fire kantstykker med deres kuldebro (ψ) og en åbningsdetalje: sålbænk, indfatning, over- og underliggere. En dør mellem to rum giver en passage — en vej, man kan gå.',
                    'Windows and doors are openings the surface hosts (bot:hostsElement). Each has four perimeter edges with their thermal bridge (ψ) and an opening detail: sill flashing, frame boards, head and sill boards. A door between two rooms makes a passage — a way one can walk.'
                ),
                terms: ['twb:Opening', 'twb:OpeningEdge', 'twb:Passage'],
            },
            {
                term: 'twb:Blueprint',
                title: t(
                    'Blueprintet bærer standarderne og reglerne',
                    'The blueprint carries the standards and the rules'
                ),
                body: t(
                    'Projektets standarder pr. kanttype, skabeloner, det arkitektoniske udtryk, bygningens anvendelse og dens regler. Reglerne er data (twb:AdjacencyRule): "mod et vådrum kræves vådrumssikring", "en ydervæg i en helårsbolig højst 0,30 W/m²K". Og beslutningerne bag værdierne, med deres kilde.',
                    'The project’s standards per edge type, templates, the architectural expression, the building’s use and its rules. Rules are data (twb:AdjacencyRule): "towards a wet room, a wet-room lining", "an exterior wall of a dwelling at most 0.30 W/m²K". And the decisions behind the values, with their source.'
                ),
                terms: ['twb:Blueprint', 'twb:AdjacencyRule', 'twb:Decision'],
            },
        ],
        derivedTitle: t('Resten er afledt', 'The rest is derived'),
        derived: t(
            'Alt på elementniveau — reglar, plader, brædder, bearbejdninger — er afledt af blueprintet ved en deterministisk kompilering (twb:Derivation, en prov:Activity, der følger blueprintet som sin plan). Det er det, der gør blueprintet til en skabelon for bygningen frem for en model af den.',
            'Everything at element level — members, sheets, boards, machining — is derived from the blueprint by a deterministic compilation (twb:Derivation, a prov:Activity that follows the blueprint as its plan). That is what makes the blueprint a template of the building rather than a model of it.'
        ),
        showInSchema: t('Vis i skemaet', 'Show in the schema'),
    },
    wallLine: {
        kicker: t('02 · Væglinjen', '02 · The wall line'),
        title: t('Hvor den tynde væg ligger', 'Where the thin wall lies'),
        lead: t(
            'En flade uden tykkelse skal ligge et bestemt sted i væggen, ellers ved ingen, hvor lagene skal hen. TWB lægger den altid midt i det, der bærer: den del af væggen, taget og etagerne hviler på. Det er dér, huset sættes ud på sit modul — og opbygningen lægges ud til begge sider derfra.',
            'A surface with no thickness has to lie somewhere definite in the wall, or nobody knows where the layers go. TWB always puts it through the middle of what carries: the part of the wall the roof and the floors rest on. That is where the house is set out on its module — and the build-up is laid out to both sides from there.'
        ),
        timber: {
            title: t('Træhuse: midt i stolperne', 'Timber frame: through the studs'),
            body: t(
                'Linjen går midt gennem stolperne, råhusets bærende skelet, før isolering, beklædning og plader. Huset sættes ud på pladens modul, 1200 og 600, målt fra linje til linje — så en 7200 bred plan er 7200 mellem stolpernes midter. Udvendigt over beklædningen er huset større, og rummet indenfor mindre; det regner programmet selv ud af opbygningen.',
                'The line runs through the middle of the studs, the carcass that carries, before insulation, cladding and boards. The house is set out on the sheet module, 1200 and 600, line to line — so a plan 7200 wide is 7200 between the studs’ centres. Over the cladding the house is larger and inside the room is smaller; the program works both out from the build-up.'
            ),
        },
        masonry: {
            title: t('Murede huse: midt i bagmuren', 'Masonry: through the inner leaf'),
            body: t(
                'I en hulmur bærer bagmuren taget og remmen; formuren er en skal udenpå. Linjen går derfor midt i bagmuren, og det er den, der sættes ud i murmål: hele halve sten, 120, fra linje til linje. Hulmuren gøres så bred, at formuren også går op — så længden over formuren bliver n × 120 − 12, hele sten med normale fuger. Med 100 mm bagmur og 108 mm tegl bliver hulmuren 196 mm, og linjen ligger 354 mm inde fra facaden.',
                'In a cavity wall the inner leaf carries the roof and its wall plate; the facing brick is a skin outside it. So the line runs through the middle of the inner leaf, and that is what is set out in brick measure: whole half bricks, 120, line to line. The cavity is made as wide as puts the facing brick on the module too — so the length over the brick is n × 120 − 12, whole bricks with standard joints. With a 100 mm inner leaf and 108 mm brick the cavity is 196 mm, and the line lies 354 mm in from the face.'
            ),
        },
        party: {
            title: t('Skillevægge og lejlighedsskel: midt i det bærende lag', 'Partitions and party walls: through the layer that carries'),
            body: t(
                'En skillevæg står på samme måde midt i det, der bærer: stolperne eller muren. Dens opbygning går fra fladens forside — til højre, set langs væggen mod +x, eller +y for en væg langs y — over kernen til bagsiden, så lagene efter kernen ligger på bagsiden. Et lejlighedsskel af to bærende vanger står på den ene: mellem to rum den, der har den anden på sin bagside; i facaden sin egen boligs. En forsatsvæg op ad en væg er en del af den vægs opbygning, dér hvor den står. Så måles rummene på begge sider af skellet ens, til væggenes flader.',
                'A partition stands the same way, through the middle of what carries: the studs or the masonry. Its build-up runs from the surface’s front — to the right looking along the wall towards +x, or +y for a wall along y — across the core to its back, so the layers past the core lie on the back. A party wall of two leaves that carry stands on one: between two rooms the one with the other on its back; on the outline its own dwelling’s. A lining against a wall is part of that wall’s build-up where it stands. So the rooms on both sides of the party wall measure alike, to the walls’ faces.'
            ),
        },
        rule: t(
            'Én regel for begge: linjen er konstruktionens, modulet gælder linjen, og alt andet er afstande fra den, som opbygningen giver. Hulmurens bredde er en standard, programmet regner ud; vælger man en anden, gemmes den i husfilen og vinder.',
            'One rule for both: the line is the structure’s, the module applies to the line, and everything else is a distance from it that the build-up gives. The cavity’s width is a default the program works out; choose another and it is saved in the house file and wins.'
        ),
        figure: {
            line: t('linjen', 'the line'),
            inside: t('inde', 'inside'),
            outside: t('ude', 'outside'),
            front: t('forside', 'front'),
            back: t('bagside', 'back'),
        },
    },
    types: {
        kicker: t('03 · Typerne', '03 · The types'),
        title: t('Én type, mange forekomster', 'One type, many instances'),
        lead: t(
            'En type er en prototype: den holder det, der gælder for alle dens forekomster, sat én gang og delt. Vægge, tage og dæk er forekomster af en opbygning — dens lag — og vinduer og døre af en vindues- eller dørtype. Hver slags har en standardtype, som en forekomst uden andet er; en forekomst knyttes til en anden type ved dens id; det, en forekomst selv siger, vinder over typens; og en type gemmes kun med det, der afviger fra standarden.',
            'A type is a prototype: it holds what holds for every instance of it, set once and shared. Walls, roofs and slabs are instances of a build-up — its layers — and windows and doors of a window or door type. Each kind has a default type, which an instance pinned to no other is; an instance is pinned to another type by its id; what an instance states itself wins over its type’s; and a type is saved with only what differs from the default.'
        ),
        buildUps: {
            title: t('Opbygninger: vægge, tage, dæk', 'Build-ups: walls, roofs, slabs'),
            body: t(
                'En opbygning (twb:Recipe) er lagene, en flade er lavet af, indefra og ud, med kernen markeret. Hver slags flade har sin i envelope — ydervæggen, husets skillevæg, lejlighedsskellet, taget, dækket — og én mere af en slags er "<slags>:<nøgle>", fx "lightPartition:plumbing". En flade knyttes til den med buildUpType. Så har badets installationsvæg sine 184 mm og lejlighedsskellet sine 550, uden at nogen af væggene gemmer en tykkelse.',
                'A build-up (twb:Recipe) is the layers a face is made of, inside to outside, the core marked. Each kind of face has its own in envelope — the exterior wall, the house’s partition, the party wall, the roof, the deck — and one more of a kind is "<kind>:<key>", such as "lightPartition:plumbing". A face is pinned to it with buildUpType. So the bathroom’s plumbing wall has its 184 mm and the party wall its 550, with no wall storing a thickness.'
            ),
        },
        openings: {
            title: t('Vindues- og dørtyper', 'Window and door types'),
            body: t(
                'En vindues- eller dørtype (twb:OpeningType) er produktet, rammen og karmen, rudelagene, U-værdien, farverne og opdelingen — det, alle vinduer af typen deler. Den hører til en plads: vinduer i en væg, ovenlys, hoveddøre, terrassedøre, garageporte. Pladsens standard har pladsens id, "window"; flere hedder "window-2" og videre. Et vindue knyttes til sin type med typeId; har det sin egen opdeling, vinder den.',
                'A window or door type (twb:OpeningType) is the product, the frame and sash, the panes, the U-value, the colours and the division — what every window of the type shares. It belongs to a slot: windows in a wall, roof windows, entrance doors, terrace doors, garage doors. The slot’s default has the slot’s id, "window"; more are "window-2" and on. A window is pinned to its type with typeId; where it has a division of its own, that wins.'
            ),
        },
        rule: t(
            'Fra IFC: hver vægtype og hvert lagsæt bliver en opbygning, hver IfcWindowType og IfcDoorType (IfcWindowStyle, IfcDoorStyle i IFC2X3) en vindues- eller dørtype, og hver væg, hvert vindue og hver dør knyttes til sin.',
            'From IFC: every wall type and layer set becomes a build-up, every IfcWindowType and IfcDoorType (IfcWindowStyle, IfcDoorStyle in IFC2X3) a window or door type, and every wall, window and door is pinned to its own.'
        ),
        figure: {
            type: t('typen', 'the type'),
            instances: t('forekomsterne', 'the instances'),
            own: t('egen opdeling', 'own division'),
        },
    },
    modules: {
        kicker: t('04 · Modulerne', '04 · The modules'),
        title: t('Én ontologi, taget i dele', 'One ontology, taken in parts'),
        lead: t(
            'TWB er bygget som SEAS-ontologierne (Smart Energy Aware Systems): ét navnerum, twb:, delt af alle moduler; hvert modul er en ontologi for sig, der kun importerer de moduler, den bygger på; og hvert begreb siger, hvilket modul der definerer det (rdfs:isDefinedBy). https://w3id.org/twb importerer dem alle. Vil man kun have huset som flader, kanter og zoner, importerer man kernen alene.',
            'TWB is built as the SEAS ontologies (Smart Energy Aware Systems) are: one namespace, twb:, shared by every module; each module an ontology of its own that imports only the modules it builds on; and every term stating the module that defines it (rdfs:isDefinedBy). https://w3id.org/twb imports them all. To take only the house as surfaces, edges and zones, import the core alone.'
        ),
        imports: t('importerer', 'imports'),
        importsNothing: t('intet andet modul', 'no other module'),
        classes: t('klasser', 'classes'),
        objectProperties: t('relationer', 'object properties'),
        datatypeProperties: t('egenskaber', 'datatype properties'),
        download: t('Hent', 'Download'),
        names: {
            core: t('Kerne', 'Core'),
            construction: t('Konstruktion', 'Construction'),
            detailing: t('Detaljering', 'Detailing'),
            requirements: t('Krav', 'Requirements'),
            profile: t('Projektprofil', 'Project profile'),
            decision: t('Beslutninger', 'Decisions'),
            derivation: t('Afledning', 'Derivation'),
            housefile: t('Husfil', 'House file'),
            doc: t('Dokumentation', 'Documentation'),
        } as Record<string, Text>,
        descriptions: {
            core: t(
                'Skelettet: blueprintet, etager, zoner (rum, omgivelser, lofter, passager gennem døre) og inventar, de tynde flader med deres sider og zonegrænser, åbningerne de hoster, kanterne og knuderne hvor de mødes, linjeelementer og fundamenter. Intet om, hvad noget er bygget af.',
                'The skeleton: the blueprint, storeys, zones (rooms, the environment, attics, passages through doors) and fittings, the thin surfaces with their sides and zone boundaries, the openings they host, the edges and nodes where they meet, line elements and foundations. Nothing of what anything is built of.'
            ),
            construction: t(
                'Hvad en flade er bygget af: opskrifter og deres lag, materialer, mønstre af reglar, beklædning, fald, murværk og bindere, belægninger på zonegrænser, U- og ψ-værdier.',
                'What a surface is built of: recipes and their layers, materials, patterns of members, cladding, taper, masonry and wall ties, coverings on zone boundaries, U- and ψ-values.'
            ),
            detailing: t(
                'Hvordan opskrifterne mødes: samlinger på kanter med lagenes afslutninger og lister, skabeloner og projektstandarder, åbningsdetaljer, brædder over en samling, listers møde i knuder og skeletreglerne med deres BTLx-bearbejdninger.',
                'How recipes meet: joints on edges with the layers’ terminations and trims, templates and project standards, opening details, boards across a seam, how trims meet at nodes, and the framing rules with their BTLx processings.'
            ),
            requirements: t(
                'Hvad konstruktionen skal kunne, hvor en zone møder en flade: evner, nabo-regler som data, de krav de udleder, og U-værdi-grænser.',
                'What the construction must do where a zone meets a surface: capabilities, adjacency rules as data, the requirements they infer, and U-value limits.'
            ),
            profile: t(
                'Projektets valg: det arkitektoniske udtryk og de lister det afleder, bygningens anvendelse, der vælger reglerne, konstruktionssystemet og de statiske parametre.',
                'The project’s choices: the architectural expression and the trims it derives, the building’s use that selects the rules, the construction system and the structural parameters.'
            ),
            decision: t(
                'Hvor værdierne kom fra: beslutninger i tre niveauer (profil, standard, undtagelse), deres værdi og kilde — en tegning eller en antagelse.',
                'Where the values came from: decisions in three tiers (profile, standard, override), their value and source — a drawing or an assumption.'
            ),
            derivation: t(
                'Bygningen på elementniveau, afledt af blueprintet: afledningen, reglarne med deres rolle, tværsnit og bearbejdninger, pladerne og hvad der styrede hver.',
                'The building at element level, derived from the blueprint: the derivation, the members with their roles, sections and processings, the layer pieces, and what governed each.'
            ),
            housefile: t(
                'Det husfilen (twb/1) skal bruge ud over resten: geometri som tegnet, i millimeter som JSON, og henvisninger ved navn.',
                'What the house file (twb/1) needs beyond the rest: geometry as drawn, in millimetres as JSON, and references by name.'
            ),
            doc: t(
                'Dokumentationen: snittene brugeren har placeret eller fravalgt, og tegningssættet afledt af blueprintet — ark, tegninger og målestok.',
                'The documentation: the sections the user placed or left out, and the drawing set derived from the blueprint — sheets, drawings and scale.'
            ),
        } as Record<string, Text>,
        alongsideTitle: t('Ved siden af', 'Alongside'),
        alongside: [
            {
                id: 'shapes',
                file: 'twb-shapes.ttl',
                text: t(
                    'SHACL-reglerne: hvad et velformet blueprint er, og om konstruktionen opfylder kravene.',
                    'The SHACL shapes: what a well-formed blueprint is, and whether its construction meets its requirements.'
                ),
            },
            {
                id: 'align',
                file: 'twb-align.ttl',
                text: t(
                    'Koblinger til BPO, DiCon, SML, BEO, ifcOWL og OPM — holdt udenfor, så TWB aldrig tvinger dem med.',
                    'Alignments with BPO, DiCon, SML, BEO, ifcOWL and OPM — kept apart, so TWB never forces them on anyone.'
                ),
            },
            {
                id: 'catalogue/arch',
                file: 'twb-catalogue.ttl',
                text: t(
                    'archs kataloger som SKOS: rumtyper, reglar-roller, bearbejdninger, materialer, anvendelser.',
                    'arch’s catalogues as SKOS: zone kinds, member roles, processings, materials, building uses.'
                ),
            },
        ],
        useTitle: t('Sådan bruger du et modul', 'Using a module'),
        use: t(
            'Adresserne svarer en RDF-klient med Turtle og en browser med denne side. Begreberne har samme IRI, hvilket modul man end importerer.',
            'The addresses answer an RDF client with Turtle and a browser with this page. A term has the same IRI whichever module one imports.'
        ),
    },
    schema: {
        kicker: t('05 · Skemaet', '05 · The schema'),
        title: t('Hele ontologien, til at trække i', 'The whole ontology, to pull at'),
        lead: t(
            'Klasserne og relationerne i alle TWB’s moduler, tegnet i VOWL-notationen fra WebVOWL. Træk i en klasse, zoom og panorer, klik for at se, hvad den er, hvad den hænger sammen med, og hvor mange af den casehuset har.',
            'The classes and relations of every TWB module, drawn in the VOWL notation of WebVOWL. Drag a class, zoom and pan, click to see what it is, what it connects to, and how many of it the case house has.'
        ),
        loading: t('Lægger skemaet ud …', 'Laying out the schema …'),
        search: t('Find en klasse', 'Find a class'),
        modules: t('Moduler', 'Modules'),
        allModules: t('Alle', 'All'),
        external: t('BOT, PROV, GeoSPARQL', 'BOT, PROV, GeoSPARQL'),
        vocabularies: t('SKOS-ordlister', 'SKOS vocabularies'),
        labels: t('Navne på relationer', 'Relation names'),
        fit: t('Vis hele', 'Fit'),
        hint: t(
            'Træk for at flytte · scroll for at zoome · træk i baggrunden for at panorere · klik på en klasse',
            'Drag to move · scroll to zoom · drag the background to pan · click a class'
        ),
        legend: {
            cls: t('Klasse i TWB', 'TWB class'),
            external: t('Klasse fra BOT, PROV …', 'Class from BOT, PROV …'),
            property: t('Relation: domæne → værdiområde', 'Relation: domain → range'),
            subclass: t('Underklasse af', 'Subclass of'),
        },
        panel: {
            empty: t(
                'Klik på en klasse i skemaet for at se dens definition, dens plads i hierarkiet og dens relationer.',
                'Click a class in the schema to see its definition, its place in the hierarchy and its relations.'
            ),
            superClasses: t('Underklasse af', 'Subclass of'),
            subClasses: t('Underklasser', 'Subclasses'),
            outgoing: t('Relationer ud', 'Relations out'),
            incoming: t('Relationer ind', 'Relations in'),
            attributes: t('Egenskaber', 'Attributes'),
            archTerm: t('I koden', 'In the code'),
            ifc: t('I IFC', 'In IFC'),
            instances: t('I casehuset', 'In the case house'),
            instancesN: t('{n} individer', '{n} individuals'),
            noInstances: t('ingen — ikke brugt i casehuset', 'none — not used in the case house'),
            external: t(
                'En klasse fra en anden ontologi, som TWB bygger videre på.',
                'A class from another ontology that TWB builds on.'
            ),
            functional: t('højst én', 'at most one'),
            close: t('Luk', 'Close'),
        },
        noscript: t(
            'Skemaet tegnes i browseren. Ontologien kan hentes som Turtle herunder.',
            'The schema is drawn in the browser. The ontology can be downloaded as Turtle below.'
        ),
    },
    examples: {
        kicker: t('06 · Modellering', '06 · Modelling'),
        title: t(
            'Dele af et hus, som filen og som graf',
            'Parts of a house, as the file and as a graph'
        ),
        lead: t(
            'Eksemplerne er skåret ud af casehuset fra artiklen og vist i <arch-paper-model>, den del af værktøjet vi gør åben (Apache-2.0). Klik på en flade: til højre står det, filen siger om den, læst som JSON-LD til RDF i din browser.',
            'The examples are cut out of the paper’s case house and shown in <arch-paper-model>, the viewer in @lbd-hackers/twb (Apache-2.0). Click a face: on the right is what the file says about it, read from JSON-LD into RDF in your browser.'
        ),
        items: {
            surface: {
                tab: t('En flade', 'A surface'),
                title: t('Én flade, to vinduer', 'One surface, two windows'),
                body: t(
                    'Østvæggen alene. En flade er bare dens hjørner i millimeter på referenceplanet; vinduerne er åbninger på fladen med deres fire hjørner. Om det er en væg, læses af geometrien — lodret — og kan låses med pinnedKind.',
                    'The east wall on its own. A surface is just its corners in millimetres on the reference plane; the windows are openings on the surface with their four corners. That it is a wall is read off the geometry — vertical — and can be pinned with pinnedKind.'
                ),
            },
            edge: {
                tab: t('En kant', 'An edge'),
                title: t('To flader og deres hjørne', 'Two surfaces and their corner'),
                body: t(
                    'Syd- og vestvæggen på gulvet. Kanterne findes af værktøjet, hvor flader deler en linje, og får en type. Hjørnet mellem de to vægge har sin egen samling i filen (edgeJoints): hvert lag i hver væg skåret i gering, i stedet for husets standard, hvor den længste væg løber igennem.',
                    'The south and west walls on the floor. A deriving tool (here arch) finds the edges where surfaces share a line, and types them. The corner between the two walls has its own joint in the file (edgeJoints): every layer of each wall cut to a mitre, instead of the house’s standard, where the longer wall runs through.'
                ),
            },
            rooms: {
                tab: t('Rum', 'Rooms'),
                title: t('Skillevægge gør rum', 'Partitions make rooms'),
                body: t(
                    'Gulv, ydervægge og de fire skillevægge, uden tag. Et rum er et punkt i planen og en anvendelse (zoneKind); dets omrids findes af væggene omkring punktet. Badeværelset er vådt, og det er det, regeltjekket nedenfor bygger på.',
                    'Floor, exterior walls and the four partitions, without the roof. A room is a point in plan and a purpose (zoneKind); its outline is found from the walls around the point. The bathroom is wet, and that is what the rule check below builds on.'
                ),
            },
            house: {
                tab: t('Hele huset', 'The whole house'),
                title: t('Casehuset — prøv at ændre det', 'The case house — try changing it'),
                body: t(
                    'Hele filen: 11 flader, 4 rum, opskrifterne, en skabelon, en egen samling, standarderne og en knuderegel. Vælg Push/Pull, klik på en flade og træk: elementet ændrer huset med værktøjets egne operationer, kontrolleret mod 1200-modulet, og grafen til højre læses igen.',
                    'The whole file: 11 surfaces, 4 rooms, the recipes, a template, an own joint, the standards and a node rule. Pick Push/Pull, click a face and drag: the element changes the house with the drawing engine’s own operations, checked against the 1200 module, and the graph on the right is read again.'
                ),
            },
        },
        file: t('Filen (twb/1, JSON-LD)', 'The file (twb/1, JSON-LD)'),
        graph: t('Grafen', 'The graph'),
        triples: t('{n} tripler', '{n} triples'),
        selected: t('Det filen siger om {id}', 'What the file says about {id}'),
        pick: t(
            'Klik på en flade i modellen for at se dens tripler.',
            'Click a face in the model to see its triples.'
        ),
        classes: t('Hvad filen gør til noder', 'What the file makes nodes of'),
        loadViewer: t('Åbn modellen', 'Open the model'),
        loading: t('Henter viewer og RDF-motor …', 'Loading the viewer and the RDF engine …'),
        failed: t(
            'Viewer’en kunne ikke starte her (den kræver WebGL2).',
            'The viewer could not start here (it needs WebGL2).'
        ),
        element: t(
            'Elementet på en hvilken som helst side: <script type="module" src="arch-elements.js"> og <arch-paper-model src="house.twb.jsonld">.',
            'The element on any page: import "@lbd-hackers/twb/elements" and <arch-paper-model src="house.twb.jsonld">.'
        ),
    },
    checks: {
        kicker: t('07 · Regeltjek', '07 · Rule checks'),
        title: t('Regler, du kan læse og køre', 'Rules you can read and run'),
        lead: t(
            'Reglerne er data og SPARQL, ikke kode. Her kører de på casehuset med Oxigraph i din browser: først udleder reglerne kravene fra hvad hver flade adskiller, så tjekker SHACL-reglerne, om konstruktionen opfylder dem. Skift noget, og alt køres igen.',
            'The rules are data and SPARQL, not code. Here they run on the case house with Oxigraph in your browser: first the rules derive the requirements from what each surface separates, then the SHACL shapes check whether the construction meets them. Change something and it all runs again.'
        ),
        start: t('Kør reglerne', 'Run the rules'),
        loading: t('Henter Oxigraph og casehuset …', 'Loading Oxigraph and the case house …'),
        running: t('Kører …', 'Running …'),
        failed: t('Motoren kunne ikke starte her.', 'The engine could not start here.'),
        tabs: {
            wet: t('Vådrum', 'Wet room'),
            u: t('U-værdier', 'U-values'),
            egress: t('Flugtveje', 'Ways out'),
        },
        wet: {
            title: t('Vådrumssikring mod badet', 'Wet-room lining towards the bath'),
            body: t(
                'Regel 30 lægger et krav på hver zonegrænse, hvor en regel matcher zonen på den side. "Mod et vådrum kræves vådrumssikring" rammer de fem zonegrænser mod badeværelset: to ydervægge, to skillevægge og gulvet. Ingen af deres opskrifter giver det — så CapabilityShape melder fem fejl. Reparationen lægger en vådrumsmembran på netop de fem zonegrænser, ikke på hele væggen.',
                'Rule 30 puts a requirement on every zone boundary where a rule matches the zone on that side. "Towards a wet room, a wet-room lining" hits the five boundaries towards the bathroom: two exterior walls, two partitions and the floor. None of their recipes provides it — so CapabilityShape reports five violations. The repair puts a wet-room membrane on exactly those five boundaries, not on the whole wall.'
            ),
            repair: t('Anvend reparationen (SPARQL Update)', 'Apply the repair (SPARQL Update)'),
            capability: t('Krav', 'Requirement'),
            floorNote: t('Gulvet under badet', 'The floor under the bath'),
        },
        u: {
            title: t('U-værdi efter bygningens anvendelse', 'U-value by the building’s use'),
            body: t(
                'Regel 31 lægger BR18’s grænse på hver flade, der skiller opvarmet fra uopvarmet: 0,30 W/m²K for ydervæggen, 0,20 for gulvet og loftet mod det kolde loftrum. Taget skiller loftrummet fra det fri og får intet krav. Træk i opskriftens U-værdi og se UValueShape svare.',
                'Rule 31 puts BR18’s limit on every surface that separates heated from unheated: 0.30 W/m²K for the exterior wall, 0.20 for the floor and for the ceiling under the cold attic. The roof separates the attic from outdoors and gets none. Drag a recipe’s U-value and watch UValueShape answer.'
            ),
            recipe: t('Opskrift', 'Recipe'),
            limit: t('grænse', 'limit'),
            reset: t('Nulstil', 'Reset'),
            axis: t('U-værdi, W/m²K', 'U-value, W/m²K'),
            surface: t('Flade', 'Surface'),
        },
        egress: {
            title: t('Kan man komme ud?', 'Can one get out?'),
            body: t(
                'Hver dør mellem to zoner er en passage. Regel 41 udleder, hvilken vej man kan gå (twb:leadsTo), og EgressShape spørger, om der fra hvert rum går en vej, dør for dør, ud i det fri. Klik på en dør for at bestemme, hvilken side den kan åbnes fra — som et depotrum, der låses fra gangen.',
                'Every door between two zones is a passage. Rule 41 derives which way one can walk (twb:leadsTo), and EgressShape asks whether from every room a way leads, door by door, to the outdoor air. Click a door to decide which side it can be opened from — like a store room locked from the hall.'
            ),
            both: t('åbnes fra begge sider', 'opens from both sides'),
            from: t('åbnes kun fra {zone}', 'opens from {zone} only'),
            canLeave: t('kan forlades', 'can be left'),
            trapped: t('ingen vej ud', 'no way out'),
            outdoors: t('det fri', 'outdoors'),
            reset: t('Lås alle døre op', 'Unlock every door'),
        },
        results: t('Resultat', 'Result'),
        conforms: t('Overholder alle regler', 'Conforms to every rule'),
        violations: t('{n} brud', '{n} violations'),
        ok: t('opfyldt', 'met'),
        okBy: {
            recipe: t('opskriften', 'the recipe'),
            covering: t('belægning', 'covering'),
        },
        fails: t('ikke opfyldt', 'not met'),
        stats: t(
            '{explicit} tripler, {inferred} udledt af reglerne på {rules} ms, tjekket på {checks} ms — i din browser.',
            '{explicit} triples, {inferred} inferred by the rules in {rules} ms, checked in {checks} ms — in your browser.'
        ),
        showRule: t('Se reglen', 'Show the rule'),
        showShape: t('Se SHACL-reglen', 'Show the shape'),
        showUpdate: t('Se hvad siden har ændret', 'Show what the page changed'),
        noUpdate: t('Intet ændret endnu.', 'Nothing changed yet.'),
        legend: {
            ok: t('Krav opfyldt', 'Requirement met'),
            fail: t('Krav ikke opfyldt', 'Requirement not met'),
            covering: t('Opfyldt af belægning', 'Met by a covering'),
        },
        rooms: {
            'Living and kitchen': t('Stue og køkken', 'Living and kitchen'),
            Bathroom: t('Bad', 'Bathroom'),
            'Bedroom 1': t('Soveværelse 1', 'Bedroom 1'),
            'Bedroom 2': t('Soveværelse 2', 'Bedroom 2'),
        } as Record<string, Text>,
        recipes: {
            exteriorWall: t('Ydervæg', 'Exterior wall'),
            floor: t('Terrændæk', 'Floor slab'),
            ceiling: t('Loft, isoleret', 'Ceiling, insulated'),
        } as Record<string, Text>,
        capabilities: {
            WetRoomLining: t('Vådrumssikring', 'Wet-room lining'),
            VapourControl: t('Dampspærre', 'Vapour control'),
            WindBarrier: t('Vindspærre', 'Wind barrier'),
            WeatherProtection: t('Vejrbeskyttelse', 'Weather protection'),
        } as Record<string, Text>,
    },
    open: {
        kicker: t('08 · Åbent', '08 · Open'),
        title: t('Det åbne og det lukkede', 'What is open, what is closed'),
        lead: t(
            'Reglen er enkel: åbent er det, der definerer et blueprint og lader alle tegne, læse og udveksle det. Lukket er det, der gør et blueprint til en bygning.',
            'The rule is simple: open is what defines a blueprint and lets anyone draw, read and exchange it. Closed is what turns a blueprint into a building.'
        ),
        openTitle: t('Åbent', 'Open'),
        closedTitle: t('Værktøjet', 'arch, the tool (closed)'),
        openItems: [
            t(
                'TWB-ontologien, SHACL-reglerne, SPARQL-reglerne og casehuset — CC BY 4.0',
                'The TWB ontology, the SHACL shapes, the SPARQL rules and the case house — CC BY 4.0'
            ),
            t(
                'Husfilen twb/1 i JSON-LD: kontekst, skema, parser — Apache-2.0',
                'The twb/1 house file in JSON-LD: context, schema, parser — Apache-2.0'
            ),
            t(
                'IFC til TWB, validatoren og kommandolinjen twb — Apache-2.0',
                'IFC to TWB, the validator and the twb command line — Apache-2.0'
            ),
            t(
                'Tegnemotoren @surfacekit: flader, modulnet, push/pull, 3D — Apache-2.0',
                'The drawing engine @surfacekit: surfaces, module grid, push/pull, 3D — Apache-2.0'
            ),
            t(
                '<arch-paper-model>, viewer’en i eksemplerne ovenfor — Apache-2.0',
                '<arch-paper-model>, the viewer in the examples above — Apache-2.0'
            ),
        ],
        closedItems: [
            t(
                'Opskrifterne, skeletreglerne og EC5-dimensioneringen',
                'The recipes, the framing rules and the EC5 sizing'
            ),
            t(
                'Klimaskærmen: placering af lag, samlinger og inddækninger',
                'The envelope: layer placement, joints and trims'
            ),
            t(
                'Materialeliste, skæreplaner, pladeudlægning og IFC',
                'Bill of materials, cutting plans, sheet layout and IFC'
            ),
        ],
        decisionsTitle: t(
            'Modelvalg, der er værd at diskutere',
            'Modelling choices worth discussing'
        ),
        decisions: [
            {
                q: t(
                    'Hvorfor er en flade et bot:Element og ikke et bot:Interface?',
                    'Why is a surface a bot:Element and not a bot:Interface?'
                ),
                a: t(
                    'Den tynde flade er bygningsdelen, før den er detaljeret: den hoster sine åbninger og har sine reglar som underelementer. Grænsefladerne er der, hvor den møder zoner, andre flader, sine åbninger og punkter. Sådan forbliver BOT’s skel mellem elementer og grænseflader meningsfuldt.',
                    'The thin surface is the building element before it is detailed: it hosts its openings and has its members as sub-elements. The interfaces are where it meets zones, other surfaces, its openings and points. That keeps BOT’s distinction between elements and interfaces meaningful.'
                ),
            },
            {
                q: t(
                    'Hvorfor har en flade sider som egne noder?',
                    'Why does a surface have sides as nodes of their own?'
                ),
                a: t(
                    'Uden twb:SurfaceSide kan man hverken sige, hvilken side opskriften starter fra, eller "fliser mod badet, maling mod soveværelset". IFC’s DirectionSense og gbXML’s ordnede rum løser hver en del af det.',
                    'Without twb:SurfaceSide one can say neither which side the recipe starts from nor "tiles towards the bath, paint towards the bedroom". IFC’s DirectionSense and gbXML’s ordered spaces each solve a part of it.'
                ),
            },
            {
                q: t(
                    'Hvorfor lander krav på zonegrænser og ikke på flader?',
                    'Why do requirements land on zone boundaries, not on surfaces?'
                ),
                a: t(
                    'En skillevæg med et bad på den ene side skal kun vådrumssikres på den side, og kun der hvor badet er. Derfor lægger reparationen en belægning på zonegrænsen i stedet for at skifte væggens opskrift.',
                    'A partition with a bathroom on one side needs a wet-room lining on that side only, and only where the bath is. So the repair puts a covering on the boundary rather than changing the wall’s recipe.'
                ),
            },
            {
                q: t('Hvorfor SPARQL og ikke kode?', 'Why SPARQL and not code?'),
                a: t(
                    'En regel er en twb:AdjacencyRule — data — og én generisk forespørgsel anvender dem alle. Bygningens anvendelse vælger, hvilke regler der gælder. SPARQL CONSTRUCT kører alle steder: i Python i artiklen, i Rust, og her i din browser.',
                    'A rule is a twb:AdjacencyRule — data — and one generic query applies them all. The building’s use selects which rules apply. SPARQL CONSTRUCT runs anywhere: in Python in the paper, in Rust, and here in your browser.'
                ),
            },
        ],
        more: t(
            'Datamodellen forklaret: skemaet, eksempler og regeltjek i browseren',
            'The data model explained: the schema, examples and rule checks in the browser'
        ),
        paper: t(
            'Ontologien er en arbejdsversion til diskussion og følger artiklen Thin-walled blueprints (indsendt til Automation in Construction).',
            'The ontology is a working draft for discussion and follows the paper Thin-walled blueprints (submitted to Automation in Construction).'
        ),
    },
};
