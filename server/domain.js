export function defaultProfilePreferences(userId) {
  return {
    user_id: userId,
    visibility: { directory: false },
    notification_preferences: { dashboardRead: false },
    data_consent: { directoryPublic: false },
  };
}
