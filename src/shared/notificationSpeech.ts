export type NotificationSpeechSettings = {
  profile: 'default' | 'clear' | 'egyptian';
  voiceURI: string;
  rate: number;
};

export const defaultNotificationSpeech: NotificationSpeechSettings = {
  profile: 'default',
  voiceURI: '',
  rate: 0.95,
};
