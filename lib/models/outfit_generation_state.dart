enum OutfitGenerationState {
  idle,
  preparingImages,
  compressingImages,
  uploading,
  wakingServer,
  generatingOutfit,
  loadingProducts,
  success,
  partialSuccess,
  timeout,
  error,
}

extension OutfitGenerationStateX on OutfitGenerationState {
  bool get isBusy => switch (this) {
        OutfitGenerationState.preparingImages ||
        OutfitGenerationState.compressingImages ||
        OutfitGenerationState.uploading ||
        OutfitGenerationState.wakingServer ||
        OutfitGenerationState.generatingOutfit ||
        OutfitGenerationState.loadingProducts =>
          true,
        _ => false,
      };

  bool get isTerminal => switch (this) {
        OutfitGenerationState.success ||
        OutfitGenerationState.partialSuccess ||
        OutfitGenerationState.timeout ||
        OutfitGenerationState.error =>
          true,
        _ => false,
      };

  String get label => switch (this) {
        OutfitGenerationState.preparingImages => '正在读取照片',
        OutfitGenerationState.compressingImages => '正在压缩并准备图片',
        OutfitGenerationState.uploading => '正在安全处理照片',
        OutfitGenerationState.wakingServer => '正在唤醒 AI 服务，首次可能稍慢',
        OutfitGenerationState.generatingOutfit => '正在分析身材与需求',
        OutfitGenerationState.loadingProducts => '正在匹配商品',
        OutfitGenerationState.success => '生成完成',
        OutfitGenerationState.partialSuccess => '穿搭已生成，商品可稍后重试',
        OutfitGenerationState.timeout => 'AI 服务响应较慢，本次任务已停止，请重试',
        OutfitGenerationState.error => '生成失败，请重试',
        OutfitGenerationState.idle => '',
      };
}
