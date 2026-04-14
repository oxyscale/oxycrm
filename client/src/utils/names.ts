/**
 * Extracts the contact's first name for email greetings.
 *
 * Handles formats like:
 *   "The Property Stylists&Co (Brianna)" → "Brianna"
 *   "Clarity One Styling (David Borg)" → "David"
 *   "Sarah Mitchell" → "Sarah"
 *   "Melbourne Property Stylists" → "there" (no identifiable first name)
 *
 * Falls back to "there" if we can't confidently extract a person's name.
 */
export function getContactFirstName(leadName: string): string {
  // Check for bracketed contact name: "Company Name (Contact Name)"
  const bracketMatch = leadName.match(/\(([^)]+)\)/);
  if (bracketMatch) {
    return bracketMatch[1].trim().split(' ')[0];
  }

  // If the name looks like a person (doesn't start with common business words),
  // use the first word
  const firstWord = leadName.split(' ')[0];
  const businessPrefixes = [
    'the', 'a', 'an', 'mr', 'mrs', 'ms',
    // Common company-starting words that aren't names
  ];

  // If it's a short name (1-2 words) and doesn't look like a company, use it
  const words = leadName.trim().split(/\s+/);
  if (words.length <= 3 && !businessPrefixes.includes(firstWord.toLowerCase())) {
    return firstWord;
  }

  // For longer names that look like company names, fall back to "there"
  if (businessPrefixes.includes(firstWord.toLowerCase())) {
    return 'there';
  }

  return firstWord;
}
