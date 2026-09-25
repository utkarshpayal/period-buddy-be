export const userRoleEnum = {
  USER: 'user',
  // `admin` is the Super Admin — kept as the literal 'admin' so existing
  // accounts and tokens keep working without a data migration.
  ADMIN: 'admin',
  PARTNER: 'partner',
  DOCTOR: 'doctor',
  // Staff roles (Admin Workspace). Their permissions live in
  // config/permissions.js — never check these role strings directly in routes.
  CONTENT_SUPER_ADMIN: 'content_super_admin',
  CONTENT_ADMIN: 'content_admin',
  APP_SUPER_ADMIN: 'app_super_admin',
  APP_ADMIN: 'app_admin',
  CLINICAL_ADMIN: 'clinical_admin',
};

export const genderEnum = {
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other',
  PREFER_NOT_TO_SAY: 'prefer_not_to_say',
};

export const blogCategoryEnum = {
  GENERAL: 'general',
  HEALTH: 'health',
  LIFESTYLE: 'lifestyle',
  BEAUTY: 'beauty',
};

export const blogStatusEnum = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

export const reelStatusEnum = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};
