export const idSchema = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$', maxLength: 80 };
export const amountSchema = { type: 'string', pattern: '^(0|[1-9][0-9]{0,77})$', maxLength: 78 };
export const limitSchema = { type: 'string', pattern: '^([1-9]|[1-9][0-9]|100)$', maxLength: 3 };
