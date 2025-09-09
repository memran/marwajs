export class Security {
  static sanitizeHTML(html: string): string {
    // very small allowlist; expand as needed (server-side sanitize recommended)
    return String(html).replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '')
      .replace(/\son\w+='[^']*'/gi, '')
      .replace(/javascript:/gi, '');
  }
  static auditHTML(html: string): string[] {
    const issues: string[] = [];
    if (/<script/i.test(html)) issues.push('Inline <script> blocked');
    if (/on\w+=/i.test(html)) issues.push('Inline event handlers removed');
    if (/javascript:/i.test(html)) issues.push('javascript: URL removed');
    return issues;
  }
}