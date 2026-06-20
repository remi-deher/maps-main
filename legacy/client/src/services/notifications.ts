import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configuration du comportement des notifications au premier plan
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const setupNotifications = async () => {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    return false;
  }

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  return true;
};

export const sendLocalNotification = async (title: string, body: string, data: any = {}) => {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: true,
    },
    trigger: null, // Immédiat
  });
};

export const sendArrivalNotification = async (address: string) => {
  await sendLocalNotification(
    '🏁 Destination atteinte',
    `Vous êtes arrivé à : ${address}`,
    { type: 'ARRIVAL' }
  );
};

export const sendDisconnectNotification = async () => {
  await sendLocalNotification(
    '⚠️ Connexion perdue',
    'La liaison avec le serveur a été interrompue.',
    { type: 'DISCONNECT' }
  );
};
