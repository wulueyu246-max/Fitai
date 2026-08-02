class VirtualBodyParameters {
  const VirtualBodyParameters({
    required this.height,
    required this.weight,
    this.shoulderScale = 1,
    this.waistScale = 1,
    this.legRatio = 0.5,
  });

  final double height;
  final double weight;
  final double shoulderScale;
  final double waistScale;
  final double legRatio;

  VirtualBodyParameters copyWith({
    double? height,
    double? weight,
    double? shoulderScale,
    double? waistScale,
    double? legRatio,
  }) {
    return VirtualBodyParameters(
      height: height ?? this.height,
      weight: weight ?? this.weight,
      shoulderScale: shoulderScale ?? this.shoulderScale,
      waistScale: waistScale ?? this.waistScale,
      legRatio: legRatio ?? this.legRatio,
    );
  }

  Map<String, dynamic> toJson() => {
        'height': height,
        'weight': weight,
        'shoulderScale': shoulderScale,
        'waistScale': waistScale,
        'legRatio': legRatio,
      };
}
