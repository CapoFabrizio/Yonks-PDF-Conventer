# Clé de signature de test (publique)

`yonks-test.jks` (mot de passe et alias : `yonks-test`) signe les APK compilés par GitHub Actions
quand aucune clé privée n'est configurée. Elle est **volontairement publique** : elle permet d'installer
l'APK et de le mettre à jour par-dessus la version précédente, mais n'importe qui peut signer avec elle.

Pour une diffusion publique ou le Play Store, utilisez votre propre clé (voir le README, section Android).
