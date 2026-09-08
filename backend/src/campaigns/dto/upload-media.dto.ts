import { IsIn } from 'class-validator';
import { UploadableCampaignMediaType } from '../media.service';

/** Campo de formulário (multipart) de `POST /campaigns/media`, ao lado do arquivo em si (`file`). */
export class UploadMediaDto {
  @IsIn(['IMAGENS', 'AUDIO', 'DOCUMENTO'])
  type!: UploadableCampaignMediaType;
}
