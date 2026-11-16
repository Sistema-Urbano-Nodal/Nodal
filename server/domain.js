/* The longest full name a profile keeps, in both data twins (server/db.js and server/supabase.js): the 120 characters
   production has always kept, and the longest name the course invitation page accepts. */
export const PROFILE_NAME_MAX = 120;

export function defaultProfilePreferences(userId) {
  return {
    user_id: userId,
    visibility: { directory: false },
    notification_preferences: { dashboardRead: false },
    data_consent: { directoryPublic: false },
  };
}
