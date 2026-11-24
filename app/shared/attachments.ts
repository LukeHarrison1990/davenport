// Telling pictures shown inside an email apart from attached files.

/**
 * Whether the message's HTML actually shows this part as a picture (an <img src="cid:...">). Phones and Outlook
 * often give attached photos a Content-ID too, especially when forwarding, so a Content-ID alone doesn't mean the
 * picture appears in the email: anything the HTML doesn't show is an attachment, as Gmail treats it.
 */
export function shownInline(a: { contentId?: string }, html: string | null | undefined): boolean {
  if (!a.contentId || !html) return false;
  return html.toLowerCase().includes('cid:' + a.contentId.toLowerCase());
}
