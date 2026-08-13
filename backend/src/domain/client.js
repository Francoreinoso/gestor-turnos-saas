// ponytail: E.164 full normalization needs libphonenumber-js — basic format validation for now
export const PHONE_REGEX = /^\+\d{7,15}$/;

export const normalizeEmail = (email) => email.toLowerCase();

export const validatePhone = (phone) => {
  if (!PHONE_REGEX.test(phone)) {
    const err = new Error('invalid_phone_format');
    err.status = 400;
    throw err;
  }
};
