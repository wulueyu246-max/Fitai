const itemBudgetOptions = <String>[
  '<50',
  '50-200',
  '200-500',
  '500-1000',
  '1000+',
];

const outfitBudgetOptions = <String>[
  '300以内',
  '300-800',
  '800-1500',
  '1500-3000',
  '3000+',
];

String normalizeItemBudget(String? value) {
  final normalized = value?.trim() ?? '';
  return itemBudgetOptions.contains(normalized) ? normalized : '200-500';
}

String normalizeOutfitBudget(String? value) {
  final normalized = value?.trim() ?? '';
  return outfitBudgetOptions.contains(normalized) ? normalized : '800-1500';
}
