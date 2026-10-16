/**
 * What an IFC material is, in the catalogue's terms: which material (`ontology/twb-catalogue.ttl`) a
 * layer named `Masonry - Brick`, `Insulation / Thermal Barriers - Rigid insulation` or
 * `Gipsplade 13 mm` stands for, and what part it plays in a build-up — a leaf that carries, a
 * layer of studs, insulation, a board, a membrane, air, a covering.
 *
 * IFC names its materials in free text, in whatever language the model was drawn in, so this is
 * a list of patterns read in order, English and Danish (and the common Revit, ArchiCAD and
 * MagiCAD names), the first that matches winning. A name nothing matches is read by the kind of
 * word it has left (`board`, `plate`, `membrane`) and, failing that, as a board — and is
 * reported, so the person reading the import knows which layer was guessed.
 *
 * Pure: no DOM.
 */

/** What a layer does in its build-up. */
export type LayerRole =
    /** A leaf of masonry or concrete that can carry: a heavy core. */
    | 'heavy'
    /** Timber or metal studs, joists or rafters: a light core, or battens off it. */
    | 'studs'
    | 'insulation'
    | 'board'
    | 'membrane'
    | 'air'
    /** What a roof or a facade shows: roofing, cladding, facing brick. */
    | 'covering'
    /** What a floor shows: boards, tiles, screed. */
    | 'finish';

export interface MaterialMatch {
    /** An `ENVELOPE_MATERIALS` id. */
    materialId: string;
    role: LayerRole;
    /** False when no pattern matched and the material was guessed. */
    known: boolean;
}

interface Rule {
    re: RegExp;
    materialId: string;
    role: LayerRole;
}

/** First match wins: the more particular before the more general. */
const RULES: readonly Rule[] = [
    // Hollow-core slabs, before their cores are taken for air and the rest for concrete.
    {
        re: /hollow[- ]?core|hollowcore|huldæk|hul ?dæk|\bhd(\/f)? ?\d{3}\b|spændbeton|prestressed|spæncom/i,
        materialId: 'hollow-core',
        role: 'heavy',
    },
    // Air.
    { re: /ventil|luftet|lufts?palte/i, materialId: 'air-ventilated', role: 'air' },
    {
        re: /\bair\b|air ?space|air ?gap|cavity|hulrum|\bluft/i,
        materialId: 'air-still',
        role: 'air',
    },
    // Roof coverings.
    {
        re: /grass|sedum|green ?roof|grønt? ?tag|vegetat|\bsoil\b|\bjord\b/i,
        materialId: 'green-roof',
        role: 'covering',
    },
    { re: /\bzin[ck]\b|standing seam|falsetag/i, materialId: 'zinc', role: 'covering' },
    {
        re: /roof ?til|tagsten|tegltag|clay til|concrete til|betontag/i,
        materialId: 'roofing',
        role: 'covering',
    },
    { re: /epdm|bitum|felt|tagpap|\bpap\b|tagdug/i, materialId: 'roofing-felt', role: 'covering' },
    // Insulation, the particular before the general.
    {
        re: /semi[- ]?rigid|acoustic|lyddæmp|trinlyd|underlagsmåtte/i,
        materialId: 'mw-34',
        role: 'insulation',
    },
    {
        re: /\beps\b|\bxps\b|polystyren|flamingo|\bpir\b|\bpur\b|polyuret|rigid insul|hard insul|trykfast|kingspan|celotex/i,
        materialId: 'eps-34',
        role: 'insulation',
    },
    {
        re: /wood ?fib(re|er) ?(insul|batt)|træfiber ?(isol|bat)|hunton|steico ?flex/i,
        materialId: 'wood-fibre',
        role: 'insulation',
    },
    { re: /cellulose|papirisol|papiruld/i, materialId: 'cellulose', role: 'insulation' },
    {
        re: /insul|isol|mineral ?wool|mineraluld|stenuld|glasuld|rockwool|glava|isover|paroc|\bbatts?\b/i,
        materialId: 'mw-37',
        role: 'insulation',
    },
    // A wind board of gypsum, before the membranes take it for a wind barrier.
    {
        re: /vindgips|wind ?gyps|gyps\w* ?(wind|sheathing)|(wind|sheathing) ?gyps|vindspærre ?gips|gips\w* ?vind/i,
        materialId: 'gypsum-wind',
        role: 'board',
    },
    // Membranes.
    { re: /vapou?r ?brake|dampbrems|fugtadaptiv/i, materialId: 'vapour-brake', role: 'membrane' },
    {
        re: /vapou?r|dampspær|\bpe[- ]?foli|polyethyl/i,
        materialId: 'vapour-barrier',
        role: 'membrane',
    },
    { re: /radon/i, materialId: 'radon-membrane', role: 'membrane' },
    {
        re: /underlay|undertag|roof(ing)? ?-? ?barrier/i,
        materialId: 'roof-underlay',
        role: 'membrane',
    },
    {
        re: /wind|vindspær|weather ?barrier|house ?wrap|barrier|membrane|membran|foli/i,
        materialId: 'wind-membrane',
        role: 'membrane',
    },
    { re: /roofing|tagdæk/i, materialId: 'roofing', role: 'covering' },
    // Floor and wall finishes laid in mortar, before masonry takes them.
    {
        re: /ceramic|\btiles?\b|flise|klinke|grout|fuge|mortar|mørtel/i,
        materialId: 'screed',
        role: 'finish',
    },
    {
        re: /screed|avretning|afretning|\bpuds|render|plaster(?!board)/i,
        materialId: 'screed',
        role: 'finish',
    },
    // Masonry and concrete.
    {
        re: /aerated|autoclaved|\baac\b|gasbeton|porebeton|ytong|h\+h|siporex|celcon/i,
        materialId: 'aerated-concrete',
        role: 'heavy',
    },
    {
        re: /\bbrick|\btegl|mursten|murværk|facing brick|formur|skalmur/i,
        materialId: 'brick',
        role: 'heavy',
    },
    {
        re: /concrete ?block|\bcmu\b|betonblok|letbeton|leca|lightweight (aggregate|concrete)|\bblocks?\b/i,
        materialId: 'concrete-block',
        role: 'heavy',
    },
    { re: /concrete|beton|cast[- ]in|in[- ]situ|precast/i, materialId: 'concrete', role: 'heavy' },
    { re: /masonry|\bmur\b|stone|natursten|granit/i, materialId: 'brick', role: 'heavy' },
    // Studs, joists, rafters: the layer of members.
    {
        re: /stud|lægte|batten|joist|rafter|spær|bjælke|stolpe|regel|skelet|lumber|dimensional|framing/i,
        materialId: 'softwood',
        role: 'studs',
    },
    // Boards and claddings.
    { re: /plasterboard|gyps|gips|drywall|wallboard/i, materialId: 'gypsum', role: 'board' },
    { re: /\bosb\b/i, materialId: 'osb', role: 'board' },
    { re: /plywood|krydsfiner|sheathing|\bply\b/i, materialId: 'plywood', role: 'board' },
    {
        re: /wood ?fib(re|er) ?board|træfiberplade|asfaltplade|bitumen board/i,
        materialId: 'wood-fibre-board',
        role: 'board',
    },
    {
        re: /fib(re|er) ?cement|fibercement|eternit|cembrit|\bhpl\b|facade ?(panel|sheet|plade)|facadeplade/i,
        materialId: 'facade-sheet',
        role: 'covering',
    },
    {
        re: /siding|cladding|beklædning|weatherboard|klink|facade ?board|board[- ]on[- ]board|bræddebeklædning/i,
        materialId: 'cladding',
        role: 'covering',
    },
    // Floor finishes.
    {
        re: /floor(ing)?|parket|plank|gulv|laminat|vinyl|linoleum|carpet|tæppe/i,
        materialId: 'floorboards',
        role: 'finish',
    },
    // Timber or metal as a solid layer, last: members where nothing above said what kind.
    {
        re: /wood|timber|træ|tømmer|\bfyr\b|\bgran\b|spruce|pine|\bclt\b|glulam|limtræ/i,
        materialId: 'softwood',
        role: 'studs',
    },
    { re: /steel|stål|metal|alumin/i, materialId: 'softwood', role: 'studs' },
];

/** The envelope material and role an IFC material name stands for. */
export function matchMaterial(name: string): MaterialMatch {
    for (const r of RULES) {
        if (r.re.test(name)) return { materialId: r.materialId, role: r.role, known: true };
    }
    return { materialId: 'osb', role: 'board', known: false };
}

/** Whether a material name is metal — a steel stud, a steel beam — which arch frames in timber. */
export function isMetal(name: string): boolean {
    return /steel|stål|metal|alumin/i.test(name);
}

/** Whether a material name is timber — a column or a beam arch can carry as one of its lines. */
export function isTimber(name: string): boolean {
    return /wood|timber|træ|tømmer|lumber|glulam|limtræ|clt|fyr|gran|spruce|pine|\bc(16|18|24|30)\b|\bgl\d/i.test(
        name
    );
}
