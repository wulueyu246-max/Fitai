import 'outfit.dart';
import 'avatar.dart';

class VirtualModel {
  const VirtualModel({
    required this.id,
    required this.hairstyle,
    required this.faceShape,
    required this.bodyProportion,
    required this.skinTone,
    required this.outfit,
    this.avatarImage,
    this.avatar,
  });

  final String id;
  final String? avatarImage;
  final Avatar? avatar;
  final String hairstyle;
  final String faceShape;
  final String bodyProportion;
  final String skinTone;
  final Outfit outfit;

  VirtualModel copyWith({
    String? id,
    String? avatarImage,
    Avatar? avatar,
    String? hairstyle,
    String? faceShape,
    String? bodyProportion,
    String? skinTone,
    Outfit? outfit,
  }) {
    return VirtualModel(
      id: id ?? this.id,
      avatarImage: avatarImage ?? this.avatarImage,
      avatar: avatar ?? this.avatar,
      hairstyle: hairstyle ?? this.hairstyle,
      faceShape: faceShape ?? this.faceShape,
      bodyProportion: bodyProportion ?? this.bodyProportion,
      skinTone: skinTone ?? this.skinTone,
      outfit: outfit ?? this.outfit,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'avatarImage': avatarImage,
        'avatar': avatar?.toJson(),
        'hairstyle': hairstyle,
        'faceShape': faceShape,
        'bodyProportion': bodyProportion,
        'skinTone': skinTone,
        'outfit': outfit.toJson(),
      };
}
