import { NativeModules, Platform } from 'react-native';

/**
 * Note: L'implémentation des Live Activities nécessite un module natif Swift
 * et une extension de widget dans le projet Xcode. 
 * Ce service sert d'interface JS pour piloter les activités.
 */

const { LiveActivityModule } = NativeModules;

export interface LiveActivityData {
  destinationName: string;
  progress: number; // 0 à 1
  speed: number;
  status: string;
}

export const startLiveActivity = async (data: LiveActivityData) => {
  if (Platform.OS !== 'ios') return;
  
  try {
    if (LiveActivityModule) {
      await LiveActivityModule.startActivity(data);
    } else {
      console.warn('LiveActivityModule non trouvé. Assurez-vous que le code natif est intégré.');
    }
  } catch (e) {
    console.error('Erreur lors du démarrage de la Live Activity:', e);
  }
};

export const updateLiveActivity = async (data: Partial<LiveActivityData>) => {
  if (Platform.OS !== 'ios') return;
  
  try {
    if (LiveActivityModule) {
      await LiveActivityModule.updateActivity(data);
    }
  } catch (e) {
    console.error('Erreur lors de la mise à jour de la Live Activity:', e);
  }
};

export const stopLiveActivity = async () => {
  if (Platform.OS !== 'ios') return;
  
  try {
    if (LiveActivityModule) {
      await LiveActivityModule.stopActivity();
    }
  } catch (e) {
    console.error('Erreur lors de l\'arrêt de la Live Activity:', e);
  }
};
