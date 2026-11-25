import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  PDFDocumentLoadingTask,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    activeRegion,
    dimensions,
    onLayout,
    onResponderGrant,
    onResponderMove,
    onResponderRelease,
    onResponderTerminate,
  } = usePdfRegionSelection(region, onRegionSelected);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!dimensions.width) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let loadingTask: PDFDocumentLoadingTask | undefined;

    const renderPage = async () => {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
        loadingTask = pdfjs.getDocument({ url: uri });
        const loadedDocument = await loadingTask.promise;
        const pdfPage = await loadedDocument.getPage(page);
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: dimensions.width / baseViewport.width });
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context || cancelled) return;

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const pageRenderTask = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        renderTask = pageRenderTask;
        await pageRenderTask.promise;
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : 'تعذر عرض صفحة PDF.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [dimensions.width, page, uri]);

  return (
    <View
      style={[styles.page, { aspectRatio: pageRatio > 0 ? 1 / pageRatio : 0.72 }]}
      onLayout={onLayout}
    >
      {React.createElement('canvas', {
        ref: canvasRef,
        style: { display: 'block', maxWidth: '100%' },
        'aria-label': `صفحة PDF رقم ${page}`,
      })}

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

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator accessibilityLabel="جاري عرض المستند" color={colors.primary[700]} />
          <Text accessibilityLiveRegion="polite" style={styles.statusText}>
            جاري عرض المستند…
          </Text>
        </View>
      ) : null}
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
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  statusText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[700],
    writingDirection: 'rtl',
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
