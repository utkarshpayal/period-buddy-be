// HR documents (team members, letter/certificate templates, e-signing) for
// the Admin Workspace's "People & letters" pages. Design and API contract:
// period-buddy-content (The-Nura-Admin-Website) docs/hr-documents.md.

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'intern', label: 'Intern' },
  { value: 'contract', label: 'Contract' },
  { value: 'consultant', label: 'Consultant' },
];

export const MEMBER_STATUSES = [
  { value: 'offered', label: 'Offered' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'exited', label: 'Exited' },
];

export const TEMPLATE_CATEGORIES = [
  { value: 'offer_letter', label: 'Offer letter' },
  { value: 'internship_completion', label: 'Internship completion letter' },
  { value: 'experience_letter', label: 'Experience letter' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'letterhead', label: 'Letter on letterhead' },
  { value: 'other', label: 'Other' },
];

export const TEMPLATE_KINDS = ['fixed', 'letterhead'];
export const FONT_FAMILIES = ['sans', 'serif'];
export const DOCUMENT_STATUSES = ['generated', 'sent', 'viewed', 'signed', 'revoked'];

/** Built-in {{placeholders}}, filled from the member record (utils/hrValues.js). */
export const PLACEHOLDERS = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'fullName', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'designation', label: 'Designation / role' },
  { key: 'department', label: 'Department' },
  { key: 'employmentType', label: 'Employment type' },
  { key: 'startDate', label: 'Start date' },
  { key: 'endDate', label: 'End date' },
  { key: 'compensation', label: 'Compensation / stipend' },
  { key: 'location', label: 'Location' },
  { key: 'managerName', label: 'Reporting manager' },
  { key: 'address', label: 'Address' },
  { key: 'today', label: 'Today’s date' },
  { key: 'companyName', label: 'Company name' },
  { key: 'documentNumber', label: 'Document number' },
  { key: 'documentSeq', label: 'Document number (running number only, e.g. 0007)' },
];

export const MAX_TEMPLATE_BYTES = 15 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 1024 * 1024;
export const SIGN_LINK_DAYS = 30;
export const MAX_FIELDS = 60;
export const MAX_CUSTOM_FIELDS = 30;

export const companyName = () => process.env.COMPANY_NAME || 'The Nura Care';
export const documentPrefix = () => process.env.HR_DOCUMENT_PREFIX || 'NC';
