// ponytail: E.164 full normalization needs libphonenumber-js — basic format validation for now
export const PHONE_REGEX = /^\+\d{7,15}$/;

export const normalizeEmail = (email) => email.toLowerCase();
