import React from 'react';
import { StyleSheet, View, SafeAreaView, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';

interface PageWrapperProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export const PageWrapper = ({ children, style }: PageWrapperProps) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient
        colors={colors?.bgGradient || ['#f8fafc', '#f1f5f9']}
        style={StyleSheet.absoluteFill}
        locations={[0, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <SafeAreaView style={[styles.safe, style]}>
        {children}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
});
