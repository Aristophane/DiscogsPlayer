import { normalizeText } from '@/modules/catalog/normalize';

export const ANECDOTE_VERSION = 2;
export const MIN_ANECDOTE_SCORE = 26;
export const ANECDOTE_TOPICS = [
  'recording',
  'artwork',
  'composition',
  'name',
  'unexpected',
  'milestone',
] as const;
export type AnecdoteTopic = (typeof ANECDOTE_TOPICS)[number];
export type Anecdote = {
  text: string;
  section: string | null;
  score: number;
  topic: AnecdoteTopic;
};

const EXCLUDED_SECTION =
  /^(?:notes?(?: et references)?|references|sources|bibliograph|discograph|filmograph|liens externes|external links|see also|voir aussi|track listing|liste des (?:titres|pistes)|titres|personnel|credits|classements|charts|certifications|distinctions|awards)/;
const DEPENDENT_START =
  /^(?:il|elle|ils|elles|on le|on la|et|mais|cependant|l emulation|l origine de ce|ce dernier|cette derniere|ces derniers|celui-ci|celle-ci|cette decision|cet incident|ce choix|cette idee|he|she|they|this|these|upon release|however|toutefois|ainsi|en effet|finalement|ensuite|d.ailleurs)\b/;
const BIOGRAPHY =
  /\b(?:est (?:un|une) (?:chanteur|chanteuse|musicien|musicienne|groupe|album)|is (?:an? )?(?:(?:\w+-?\w*) )?(?:singer|musician|band|studio album)|ne(?:e)? le|born on|decede(?:e)? le)\b/;
const UNCERTAIN =
  /\b(?:citation needed|reference (?:needed|necessary)|ref(?:erence)?\.? (?:necessaire|souhaitee)|a confirmer|non confirme|probablement|selon la legende|according to legend|allegedly|perhaps)\b/;
const SENSITIVE =
  /\b(?:bad trip|drog\w*|cocaine|heroine|overdose|addict\w*|alcoolis\w*|ebriete|psychiatr\w*|suicid\w*|maladie|cancer|deces|meurt|mort|noy\w*|death|died|drown\w*|illness|agress\w*|diffamation|proces|lawsuit)\b/;

/** Small, explainable editorial signals, not a claim to judge humour or factual truth. */
function assess(text: string, section: string | null, kind: 'album' | 'artist') {
  const value = normalizeText(text);
  const heading = normalizeText(section ?? '');
  // Honorary street names and isolated reviews are not stories about the music.
  if (
    /\b(?:street|avenue|boulevard|rue|place|honorary title)\b/.test(value) &&
    /\b(?:renamed|rebaptis\w*|honorary|honorifique|porte son nom)\b/.test(value) &&
    !/\b(?:pochette|album cover|enregistr\w*|recording)\b/.test(value)
  )
    return null;
  if (
    /\b(?:called it|the track|ce morceau|cette chanson)\b/.test(value) &&
    !/[«“][^»”]{2,100}[»”]/.test(text) &&
    !/\b(?:intitul\w*|titled|called [A-Z])/.test(text)
  )
    return null;
  const nameOrigin =
    /\b(?:nom|pseudonyme|surnom|sigle|stage name|name|title)\b/.test(value) &&
    /\b(?:plaisanterie|mal compris|baptis\w*|rebaptis\w*|renamed|named after|name (?:comes|came)|nom (?:(?:du groupe )?est ne|vient|provient|fait|s.inspire|est inspire)|titre (?:vient|provient|s.inspire|est inspire)|signifie|chois\w*|inspir\w*|deformation|emprunt\w*|borrowed|joke|misheard)\b/.test(
      value,
    );
  const invention =
    /\b(?:premier\w*|first)\b.{0,100}\b(?:utilis\w*|us(?:e|ed|ing)|experiment\w*|invent\w*|enregistr\w*|record\w*)\b/.test(
      value,
    ) &&
    /\b(?:stereo\w*|multipist\w*|multitrack\w*|synthes\w*|feedback|echantillonn\w*|sampling|electroni\w*)\b/.test(
      value,
    );
  const composition =
    /\b(?:inspiration pour (?:creer|composer|ecrire)|inspired (?:the creation|the writing) of)\b/.test(
      value,
    ) ||
    (/\b(?:chanson\w*|titre|morceau|song|track)\b.{0,100}\b(?:adaptation|adapt\w* de|inspir\w* (?:par|de)|reprend|reprise de|emprunt\w*|inspired by|based on)\b/.test(
      value,
    ) &&
      /\b(?:adaptation|adapt\w* de|reprend|reprise de|emprunt\w*|roman|film|livre|poeme|novel|book|movie)\b/.test(
        value,
      )) ||
    /\b(?:emprunt\w*|adapt\w*)\b.{0,70}\b(?:musique|melodie|chanson|titre)\b/.test(value);
  const unusualDebut =
    /\b(?:jou\w*|chant\w*|concert|premiere paie)\b/.test(value) &&
    /\b(?:pizzeria|laverie|abattoir|toilettes|laundromat)\b/.test(value);
  const signals: [AnecdoteTopic, number][] = [
    [
      'recording',
      /\b(?:enregistr\w*|studio|recording|recorded|microphon\w*|sample\w*|echantillon\w*|magnetophon\w*|tape loop\w*)\b/.test(
        value,
      )
        ? 12
        : 0,
    ],
    [
      'artwork',
      /\b(?:pochette\w*|cover art|album cover|photograph\w*|sleeve|illustrat\w*)\b/.test(value)
        ? 12
        : 0,
    ],
    ['name', nameOrigin ? 22 : 0],
    ['composition', composition ? 26 : 0],
    [
      'unexpected',
      /\b(?:par hasard|accident\w*|erreur\w*|oublie de|inattendu\w*|insolite\w*|surpris\w*|accidentally|by chance|mistake\w*|unexpected\w*|unusual\w*|without knowing|sans le savoir)\b/.test(
        value,
      )
        ? 28
        : unusualDebut
          ? 26
          : 0,
    ],
    ['milestone', invention ? 22 : 0],
  ];
  // A concrete musical technique is useful even without the word "accident".
  const technique =
    /\b(?:une seule prise|enregistre\w* en (?:un|une|deux|trois) (?:jour\w*|heure\w*)|single take|one take|bande\w* (?:a l.envers|ralentie\w*|acceleree\w*)|backward\w*|instruments? (?:fabrique\w*|de fortune|jouets?)|homemade instruments?|rerecording|re recording)\b/.test(
      value,
    );
  if (technique) signals.push(['recording', 26]);
  const strongest = Math.max(...signals.map(([, weight]) => weight));
  // An accident in the studio is a recording story; a catch-all "unexpected" tag
  // must not swallow all of the more useful musical topics.
  const topic = (
    ['name', 'artwork', 'composition', 'recording', 'milestone', 'unexpected'] as const
  ).find((topic) => signals.some(([candidate, weight]) => candidate === topic && weight > 0))!;
  if (!strongest) return null;
  if (
    strongest < 22 &&
    !/\b(?:bruit\w*|boucle\w*|bande\w*|objet\w*|bouteille\w*|verre\w*|casserole\w*|sample\w*|echantillon\w*|noise\w*|loop\w*|tape\w*|household|bottle\w*|glass\w*)\b/.test(
      value,
    ) &&
    !signals.some(([topic, weight]) => topic === 'artwork' && weight > 0)
  )
    return null;
  let score = strongest;
  if (signals.filter(([, weight]) => weight > 0).length > 1) score += 8;
  if (
    !composition &&
    /\b(?:inspire\w*|inspirat\w*|clin d.oeil|hommage|reference a|inspired|tribute|idea came|idee (?:vient|est venue))\b/.test(
      value,
    )
  )
    score += 12;
  if (
    /\b(?:a la place|au lieu|finalement|decid\w*|devien\w*|devenu\w*|transfor\w*|instead|decid\w*|turned into|became|rather than|so that)\b/.test(
      value,
    )
  )
    score += 7;
  if (
    /\b(?:toilettes?|salle de bain|baignoire|cuisine|garage|cave|prison|chien|chat|animal|helicoptere|aspirateur|machine a laver|bathroom|bathtub|kitchen|dog|cat|washing machine|vacuum cleaner|helicopter)\b/.test(
      value,
    )
  )
    score += 12;
  if (
    /\b(?:anecdote\w*|enregistrement|recording|pochette|artwork|composition|nom de scene|stage name|inspiration)\b/.test(
      heading,
    )
  )
    score += 4;
  if (text.length >= 150 && text.length <= 520) score += 4;
  if (BIOGRAPHY.test(normalizeText(text.split(/[.!?]/, 1)[0] ?? ''))) score -= 24;
  if (/\b(?:discographie|classement|certifi\w*|grammy|nobel|billboard|chart|awards?)\b/.test(value))
    score -= 15;
  if ((value.match(/\b\d{4}\b/g) ?? []).length >= 4) score -= 18;
  if (
    kind === 'artist' &&
    /\b(?:premier album|deuxieme album|first album|second album)\b/.test(value) &&
    strongest < 22
  )
    score -= 8;
  return score >= MIN_ANECDOTE_SCORE ? { score: Math.min(100, score), topic } : null;
}

function articleParagraphs(text: string) {
  const result: { text: string; section: string | null }[] = [];
  let section: string | null = null;
  let excludedDepth: number | null = null;
  let lines: string[] = [];
  const flush = () => {
    const paragraph = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (paragraph && excludedDepth === null) result.push({ text: paragraph, section });
    lines = [];
  };
  // Bound CPU and memory even if a provider serves an unusually long article.
  for (const line of text.slice(0, 200_000).split('\n')) {
    const heading = line.match(/^\s*(={2,6})\s*(.*?)\s*\1\s*$/);
    if (heading) {
      flush();
      const depth = heading[1]!.length;
      if (excludedDepth !== null && depth <= excludedDepth) excludedDepth = null;
      section = heading[2]!.trim().slice(0, 200);
      if (EXCLUDED_SECTION.test(normalizeText(section))) excludedDepth ??= depth;
    } else if (!line.trim()) flush();
    else {
      // TextExtracts separates paragraphs with ONE newline, not a blank line.
      // Joining a whole section discarded all its stories if one unrelated paragraph
      // contained an uncertainty marker or a sensitive biographical detail.
      lines.push(line.trim());
      flush();
    }
  }
  flush();
  return result;
}

/** Extracts complete source sentences; never fabricates a quote, punchline or event. */
export function selectWikipediaAnecdotes(
  text: string,
  kind: 'album' | 'artist',
  language: 'fr' | 'en' = 'fr',
): Anecdote[] {
  const segmenter = new Intl.Segmenter(language, { granularity: 'sentence' });
  const candidates: Anecdote[] = [];
  // For composition facts, a length bonus must not preserve a generic lead-in.
  // Narrative incidents still keep the setup that makes their outcome understandable.
  const substance = (item: Anecdote) =>
    item.score -
    (item.topic === 'composition' && item.text.length >= 150 && item.text.length <= 520 ? 4 : 0);
  for (const paragraph of articleParagraphs(text)) {
    if (
      /^[*#;{|]/.test(paragraph.text) ||
      /\b(?:entonn\w*|refrain|paroles|lyrics|sings)\b.{0,80}(?:«|:|\[|“|")/i.test(paragraph.text)
    )
      continue;
    const sentences = [...segmenter.segment(paragraph.text)].map(({ segment }) => segment.trim());
    const excluded = new Set<number>();
    sentences.forEach((sentence, index) => {
      const value = normalizeText(sentence);
      if (UNCERTAIN.test(value) || SENSITIVE.test(value)) excluded.add(index);
      // A trailing citation warning qualifies the sentence immediately before it.
      if (UNCERTAIN.test(value) && /^\s*\[/.test(sentence)) excluded.add(index - 1);
    });
    let best: Anecdote | null = null;
    for (let start = 0; start < Math.min(sentences.length, 80); start++) {
      if (DEPENDENT_START.test(normalizeText(sentences[start]!))) continue;
      let passage = '';
      for (let end = start; end < Math.min(start + 5, sentences.length); end++) {
        if (excluded.has(end)) break;
        passage += (passage ? ' ' : '') + sentences[end]!;
        if (passage.length > 680) break;
        if (passage.length < 110 || !/[.!?…][»”"')\]]?$/.test(passage)) continue;
        // Intl.Segmenter can mistake a title abbreviation for a sentence ending.
        if (/\b(?:Sgt|Dr|Mr|Mrs|Mme|M|St|Vol|No)\.$/.test(passage)) continue;
        const assessment = assess(passage, paragraph.section, kind);
        if (!assessment) continue;
        const candidate = { text: passage, section: paragraph.section, ...assessment };
        if (
          !best ||
          substance(candidate) > substance(best) ||
          (substance(candidate) === substance(best) && candidate.text.length < best.text.length)
        )
          best = candidate;
      }
    }
    if (best) candidates.push(best);
  }
  const ranked = candidates.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
  const selected: Anecdote[] = [];
  const seen = new Set<string>();
  // Prefer a different topic, then fill with the remaining strongest passages.
  for (const uniqueTopics of [true, false]) {
    for (const candidate of ranked) {
      const key = normalizeText(candidate.text);
      if (
        seen.has(key) ||
        (uniqueTopics && selected.some(({ topic }) => topic === candidate.topic))
      )
        continue;
      // Repeated or overlapping material should not occupy several places in the pool.
      if (
        selected.some((other) => {
          const a = new Set(normalizeText(other.text).split(' '));
          const b = new Set(key.split(' '));
          const intersection = [...a].filter((word) => b.has(word)).length;
          return intersection / Math.max(1, Math.min(a.size, b.size)) > 0.8;
        })
      )
        continue;
      selected.push(candidate);
      seen.add(key);
      if (selected.length === 3) return selected;
    }
  }
  return selected;
}
