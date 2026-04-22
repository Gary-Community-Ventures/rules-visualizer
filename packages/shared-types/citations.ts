// Citation URL resolver — best-effort pattern matching for legal citations.
// Supports USC, CFR, and IRC patterns. Returns undefined if no pattern matches.
//
// Used by the RAC variable viewer to make `source` fields clickable links.

const USC_PATTERN =
  /(\d+)\s+U\.?S\.?C\.?\s+(?:(?:[Ss]ec(?:tion)?|§)\s*)?(\d+[a-z]?)/

const CFR_PATTERN =
  /(\d+)\s+C\.?F\.?R\.?\s+(?:(?:[Ss]ec(?:tion)?|§)\s*)?(\d+(?:\.\d+)?)/

const IRC_PATTERN = /I\.?R\.?C\.?\s+(?:(?:[Ss]ec(?:tion)?|§)\s*)?(\d+[a-z]?)/

export function resolveCitationUrl(text: string): string | undefined {
  let m: RegExpMatchArray | null

  // USC: "7 USC 2014" → law.cornell.edu/uscode/text/7/2014
  m = text.match(USC_PATTERN)
  if (m) {
    return `https://www.law.cornell.edu/uscode/text/${m[1]}/${m[2]}`
  }

  // CFR: "7 CFR 273.9" → ecfr.gov/current/title-7/section-273.9
  m = text.match(CFR_PATTERN)
  if (m) {
    return `https://www.ecfr.gov/current/title-${m[1]}/section-${m[2]}`
  }

  // IRC: "IRC §21" → 26 USC 21
  m = text.match(IRC_PATTERN)
  if (m) {
    return `https://www.law.cornell.edu/uscode/text/26/${m[1]}`
  }

  return undefined
}
