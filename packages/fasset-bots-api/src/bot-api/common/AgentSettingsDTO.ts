import { ApiProperty } from "@nestjs/swagger";

export class AgentSettingsDTO {
    @ApiProperty()
    name: string = "";

    @ApiProperty()
    value: string = "";
}
