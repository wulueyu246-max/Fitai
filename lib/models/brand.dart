class Brand {
  const Brand({
    required this.id,
    required this.name,
    required this.shortName,
    required this.supportedCategories,
    required this.apiAvailable,
  });

  final String id;
  final String name;
  final String shortName;
  final List<String> supportedCategories;
  final bool apiAvailable;
}
