import React, { useState } from 'react';
import Pdf from 'react-native-pdf';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PdfRegion } from '@/lib/templateMappings';
import { colors, fonts } from '@/constants/theme';
import { usePdfRegionSelection } from '@/components/usePdfRegionSelection';

type Props = {
  uri: string;
  page: number;
  pageRatio: number;
  region: PdfRegion | null;
  onRegionSelected: (region: PdfRegion) => void;
};

export function PdfPagePreview({ uri, page, pageRatio, region, onRegionSelected }: Props) {
  const [error, setError] = useState<string | null>(null);
  const {
    activeRegion,
    onLayout,
    onResponderGrant,
    onResponderMove,
    onResponderRelease,
    onResponderTerminate,
  } = usePdfRegionSelection(region, onRegionSelected);

  return (
    <View
      style={[styles.page, { aspectRatio: pageRatio > 0 ? 1 / pageRatio : 0.72 }]}
      onLayout={onLayout}
    >
      <Pdf
        source={{ uri, cache: false }}
        page={page}
        singlePage
        fitPolicy={0}
        minScale={1}
        maxScale={1}
        scrollEnabled={false}
        enableDoubleTapZoom={false}
        enableTextSelection={false}
        showsVerticalScrollIndicator={false}
        style={StyleSheet.absoluteFill}
        onError={(pdfError) => setError(pdfError.message)}
      />

      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onResponderGrant}
        onResponderMove={onResponderMove}
        onResponderRelease={onResponderRelease}
        onResponderTerminate={onResponderTerminate}
      >
        {activeRegion ? (
          <View
            pointerEvents="none"
            style={[
              styles.selection,
              {
                left: `${activeRegion.left * 100}%`,
                top: `${activeRegion.top * 100}%`,
                width: `${(activeRegion.right - activeRegion.left) * 100}%`,
                height: `${(activeRegion.bottom - activeRegion.top) * 100}%`,
              },
            ]}
          />
        ) : null}
      </View>

      {error ? (
        <View style={styles.error}>
          <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.neutral[0],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    position: 'relative',
  },
  selection: {
    position: 'absolute',
    backgroundColor: 'rgba(20, 184, 166, 0.18)',
    borderWidth: 2,
    borderColor: colors.primary[600],
  },
  error: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.error[600],
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
