/**
 * Mail-merge placeholders for admin broadcasts. The admin writes one message
 * with {{name}} etc. and every recipient gets their own copy.
 *
 * {{name}} is the "smart" one: a vendor's business name, otherwise the
 * person's first name.
 */

export interface PersonalizeRecipient {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  businessName?: string;
}

export const PLACEHOLDERS = ['name', 'firstName', 'lastName', 'fullName', 'businessName', 'email'] as const;

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

export const hasPlaceholders = (...texts: (string | undefined)[]): boolean =>
  texts.some((t) => !!t && new RegExp(PLACEHOLDER_RE.source).test(t));

/** Placeholder names used in the texts that we don't know how to fill. */
export const findUnknownPlaceholders = (...texts: (string | undefined)[]): string[] => {
  const unknown = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(PLACEHOLDER_RE)) {
      if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) unknown.add(m[1]);
    }
  }
  return [...unknown];
};

export const escapeHtml = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const resolveValues = (r: PersonalizeRecipient): Record<string, string> => {
  // Guest checkouts are shadow users named "Guest User" - don't greet them as "Guest"
  const isGuest = r.firstName === 'Guest';
  const firstName = (!isGuest && r.firstName?.trim()) || 'there';
  const lastName = (!isGuest && r.lastName?.trim()) || '';
  const fullName = [firstName === 'there' ? '' : firstName, lastName].filter(Boolean).join(' ') || 'there';
  const businessName = r.businessName?.trim() || '';
  const isVendor = r.role === 'vendor';

  return {
    name: isVendor && businessName ? businessName : firstName,
    firstName,
    lastName,
    fullName,
    businessName: businessName || fullName,
    email: r.email || '',
  };
};

/**
 * Fill placeholders for one recipient. Pass `encode` (e.g. escapeHtml) when the
 * result goes into HTML, so a vendor-chosen business name can't inject markup.
 */
export const personalize = (
  text: string,
  r: PersonalizeRecipient,
  encode: (v: string) => string = (v) => v
): string => {
  const values = resolveValues(r);
  return text.replace(PLACEHOLDER_RE, (match, key: string) =>
    key in values ? encode(values[key]) : match
  );
};
